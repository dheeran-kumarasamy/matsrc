import { prisma } from "@/lib/builder-db";
import { OtpChannel, OtpDeliveryStatus, OtpPurpose } from "@matsrc/db";
import {
  MAX_SENDS_PER_WINDOW,
  MAX_VERIFY_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  SEND_WINDOW_MS,
} from "./constants";
import { computeExpiry, generateOtp, generateOtpSalt, hashOtp, isExpired, verifyOtpHash } from "./crypto";

// Core persistence + lifecycle for the shared, purpose-bound OtpChallenge
// model (see packages/db/prisma/schema.prisma). Owns generation, hashing,
// expiry, attempt-limiting, resend cooldown, invalidation-on-reissue and
// single-use verification — NO delivery-provider logic lives here (see
// ./delivery.ts), per the task spec's "the delivery provider must NOT own
// OTP verification" requirement.
//
// SECURITY INVARIANTS (mirrors apps/web/lib/contact-verification/service.ts):
//  - Every lookup filters on `purpose` in addition to its other scope
//    columns — a LOGIN_OTP row can never satisfy a PO_APPROVAL_OTP
//    verification query and vice versa.
//  - Only a salted hash of the OTP is ever persisted.
//  - A verified row is marked `usedAt` in the same update that the caller's
//    business action succeeds — single-use, no replay.
//  - Issuing a new challenge for the same (purpose, identifier[,
//    purchaseOrderId]) scope overwrites/invalidates any previous one.

export type ChallengeScope = {
  purpose: OtpPurpose;
  identifier: string; // normalized phone (E.164) or email
  userId?: string | null;
  purchaseOrderId?: string | null;
};

export type IssueResult =
  | { ok: true; challengeId: string; otp: string; expiresAt: Date }
  | { ok: false; code: "COOLDOWN" | "RATE_LIMITED"; message: string; retryAfterMs?: number };

/** Finds the single active (not used, not necessarily unexpired) challenge for a scope. */
async function findActiveChallenge(scope: ChallengeScope) {
  return prisma.otpChallenge.findFirst({
    where: {
      purpose: scope.purpose,
      identifier: scope.identifier,
      purchaseOrderId: scope.purchaseOrderId ?? null,
      usedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Generates and persists a new OTP challenge for `scope`, enforcing resend
 * cooldown and the rolling send-rate window. Does NOT send anything — the
 * caller (see ./delivery.ts) is responsible for dispatching the returned
 * plaintext `otp` and must never persist or log it itself.
 *
 * Issuing a new challenge here immediately invalidates any previous
 * not-yet-used challenge for the same scope (old OTP becomes unusable).
 */
export async function issueOtpChallenge(scope: ChallengeScope): Promise<IssueResult> {
  const now = new Date();
  const existing = await findActiveChallenge(scope);

  if (existing && !isExpired(existing.expiresAt, now)) {
    const cooldownEndsAt = new Date(existing.lastSentAt.getTime() + RESEND_COOLDOWN_MS);
    if (cooldownEndsAt.getTime() > now.getTime()) {
      return {
        ok: false,
        code: "COOLDOWN",
        message: "Please wait before requesting another OTP.",
        retryAfterMs: cooldownEndsAt.getTime() - now.getTime(),
      };
    }
  }

  if (existing) {
    const windowActive = now.getTime() - existing.createdAt.getTime() < SEND_WINDOW_MS;
    if (windowActive && existing.sendCount >= MAX_SENDS_PER_WINDOW) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "Too many OTP requests. Please try again later.",
        retryAfterMs: existing.createdAt.getTime() + SEND_WINDOW_MS - now.getTime(),
      };
    }
  }

  const otp = generateOtp();
  const salt = generateOtpSalt();
  const otpHash = hashOtp(otp, salt);
  const expiresAt = computeExpiry(now);
  const windowActiveForCount = !!existing && now.getTime() - existing.createdAt.getTime() < SEND_WINDOW_MS;
  const sendCount = windowActiveForCount ? existing!.sendCount + 1 : 1;

  // Invalidate any previous not-yet-used challenge for this exact scope by
  // marking it used (so it can never later be verified) before creating the
  // fresh one — mirrors PendingContactVerification's upsert-based
  // invalidation, but OtpChallenge has no natural unique constraint to
  // upsert against (purchaseOrderId is nullable/shared across purposes), so
  // this is done as an explicit two-step update + create inside a
  // transaction instead.
  const created = await prisma.$transaction(async (tx) => {
    if (existing && !existing.usedAt) {
      await tx.otpChallenge.update({
        where: { id: existing.id },
        data: { usedAt: now },
      });
    }

    return tx.otpChallenge.create({
      data: {
        purpose: scope.purpose,
        userId: scope.userId ?? null,
        identifier: scope.identifier,
        purchaseOrderId: scope.purchaseOrderId ?? null,
        otpHash,
        otpSalt: salt,
        expiresAt,
        maxAttempts: MAX_VERIFY_ATTEMPTS,
        lastSentAt: now,
        sendCount,
        // Placeholder channel/provider — overwritten by recordDeliveryAttempt()
        // once the delivery service actually attempts a send. A channel is
        // required (NOT NULL) at creation time since the row must exist
        // before any send is attempted (the row IS the challenge the
        // provider is dispatching).
        channel: OtpChannel.SMS,
        provider: "pending",
        deliveryStatus: OtpDeliveryStatus.PENDING,
      },
    });
  });

  return { ok: true, challengeId: created.id, otp, expiresAt };
}

/** Records the outcome of a delivery attempt against a challenge (never the plaintext OTP). */
export async function recordDeliveryAttempt(
  challengeId: string,
  result: {
    channel: OtpChannel;
    provider: string;
    status: OtpDeliveryStatus;
    providerMessageId?: string | null;
    error?: string | null;
  }
): Promise<void> {
  await prisma.otpChallenge.update({
    where: { id: challengeId },
    data: {
      channel: result.channel,
      provider: result.provider,
      deliveryStatus: result.status,
      providerMessageId: result.providerMessageId ?? null,
      lastError: result.error ?? null,
    },
  });
}

export type VerifyResult =
  | { ok: true; userId: string | null; identifier: string }
  | {
      ok: false;
      code: "NOT_FOUND" | "EXPIRED" | "INVALID_OTP" | "TOO_MANY_ATTEMPTS";
      message: string;
    };

/**
 * Verifies `otp` against the active challenge for `scope`. Enforces purpose
 * binding (via `scope.purpose` in the lookup), expiry, attempt limits, and
 * single-use (marks `usedAt` on success so the same OTP can never be
 * replayed for this or any other action).
 */
export async function verifyOtpChallenge(scope: ChallengeScope, otp: string): Promise<VerifyResult> {
  const challenge = await findActiveChallenge(scope);

  if (!challenge) {
    return { ok: false, code: "NOT_FOUND", message: "No active OTP found. Please request a new one." };
  }

  const now = new Date();
  if (isExpired(challenge.expiresAt, now)) {
    return { ok: false, code: "EXPIRED", message: "This OTP has expired. Please request a new one." };
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: now } });
    return { ok: false, code: "TOO_MANY_ATTEMPTS", message: "Too many incorrect attempts. Please request a new OTP." };
  }

  const isValid = verifyOtpHash(otp, challenge.otpHash, challenge.otpSalt);
  if (!isValid) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    const remaining = challenge.maxAttempts - (challenge.attempts + 1);
    return {
      ok: false,
      code: "INVALID_OTP",
      message:
        remaining > 0
          ? `Incorrect OTP. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
          : "Incorrect OTP. Please request a new one.",
    };
  }

  // Single-use: mark verified immediately so the same OTP can never be
  // replayed (e.g. against a different PO, or twice for the same action).
  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: now } });

  return { ok: true, userId: challenge.userId, identifier: challenge.identifier };
}
