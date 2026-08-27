import { prisma } from "@/lib/builder-db";
import type { ContactVerificationChannel } from "@matsrc/db";

import {
  RESEND_COOLDOWN_MS,
  MAX_VERIFY_ATTEMPTS,
  MAX_SENDS_PER_WINDOW,
  SEND_WINDOW_MS,
  generateOtp,
  generateOtpSalt,
  hashOtp,
  verifyOtpHash,
  isExpired,
  computeExpiry,
} from "./otp";
import { normalizeEmail, isValidEmailFormat, normalizePhone } from "./validation";
import { maskEmail, maskPhone } from "./mask";
import { sendOtpEmail } from "./email-sender";
import { sendOtpSms } from "./sms-sender";

// Orchestrates the whole "change email/phone requires OTP" flow for
// apps/web/app/(builder)/profile (task spec). See the PendingContactVerification
// Prisma model doc-comment for the storage design rationale.
//
// SECURITY INVARIANTS enforced here (spec §4):
//  - The live User.email/User.phone column is NEVER written until OTP
//    verification succeeds.
//  - Every read/write of a PendingContactVerification row is scoped by
//    `userId` (never by id alone), so one user can never verify or read
//    another user's pending change — mirrors lib/sourcing/session-store.ts's
//    authorization invariant.
//  - Duplicate-conflict handling never reveals to the caller which OTHER
//    account owns a conflicting email/phone — only that "this value can't be
//    used" (a generic message).
//  - OTPs are single-use: a verified row is deleted immediately in the same
//    transaction, so replay is prevented.

export type InitiateResult =
  | { ok: true; maskedTarget: string; expiresAt: Date; resendAvailableAt: Date }
  | {
      ok: false;
      code: "INVALID_FORMAT" | "CONFLICT" | "RATE_LIMITED" | "COOLDOWN" | "UNCHANGED";
      message: string;
      retryAfterMs?: number;
    };

export type VerifyResult =
  | { ok: true; value: string }
  | { ok: false; code: "NOT_FOUND" | "EXPIRED" | "INVALID_OTP" | "TOO_MANY_ATTEMPTS" | "CONFLICT"; message: string };

function otpTargetLabel(channel: ContactVerificationChannel): string {
  return channel === "EMAIL" ? "email address" : "phone number";
}

async function findConflictingUser(
  channel: ContactVerificationChannel,
  value: string,
  excludingUserId: string
): Promise<boolean> {
  const where = channel === "EMAIL" ? { email: value } : { phone: value };
  const existing = await prisma.user.findFirst({
    where: { ...where, NOT: { id: excludingUserId } },
    select: { id: true },
  });
  return !!existing;
}

/**
 * Starts (or resends) an OTP-verification flow for changing `channel` to
 * `rawValue` on behalf of `userId`. Does NOT touch the live User row.
 */
export async function initiateContactChange(
  userId: string,
  channel: ContactVerificationChannel,
  rawValue: string
): Promise<InitiateResult> {
  let normalized: string | null;
  if (channel === "EMAIL") {
    normalized = isValidEmailFormat(rawValue) ? normalizeEmail(rawValue) : null;
  } else {
    normalized = normalizePhone(rawValue);
  }

  if (!normalized) {
    return {
      ok: false,
      code: "INVALID_FORMAT",
      message:
        channel === "EMAIL"
          ? "Enter a valid email address."
          : "Enter a valid phone number, including country code if outside India.",
    };
  }

  const currentUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!currentUser) {
    return { ok: false, code: "INVALID_FORMAT", message: "Account not found." };
  }

  const currentValue = channel === "EMAIL" ? currentUser.email : currentUser.phone;
  if (currentValue && currentValue === normalized) {
    return {
      ok: false,
      code: "UNCHANGED",
      message: `That's already your verified ${otpTargetLabel(channel)}.`,
    };
  }

  // Never disclose which other account owns the conflicting value — a
  // uniform message regardless of channel or reason (task spec §4).
  if (await findConflictingUser(channel, normalized, userId)) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `This ${otpTargetLabel(channel)} can't be used. Please try a different one.`,
    };
  }

  const now = new Date();
  const existingPending = await prisma.pendingContactVerification.findUnique({
    where: { userId_channel: { userId, channel } },
  });

  if (existingPending) {
    const cooldownEndsAt = new Date(existingPending.lastSentAt.getTime() + RESEND_COOLDOWN_MS);
    if (cooldownEndsAt.getTime() > now.getTime()) {
      return {
        ok: false,
        code: "COOLDOWN",
        message: "Please wait before requesting another code.",
        retryAfterMs: cooldownEndsAt.getTime() - now.getTime(),
      };
    }

    const windowActive = now.getTime() - existingPending.windowStartedAt.getTime() < SEND_WINDOW_MS;
    if (windowActive && existingPending.sendCount >= MAX_SENDS_PER_WINDOW) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "Too many verification codes requested. Please try again later.",
        retryAfterMs: existingPending.windowStartedAt.getTime() + SEND_WINDOW_MS - now.getTime(),
      };
    }
  }

  const otp = generateOtp();
  const salt = generateOtpSalt();
  const otpHash = hashOtp(otp, salt);
  const expiresAt = computeExpiry(now);

  const windowActiveForCount =
    !!existingPending && now.getTime() - existingPending.windowStartedAt.getTime() < SEND_WINDOW_MS;
  const windowStartedAt = windowActiveForCount ? existingPending!.windowStartedAt : now;
  const sendCount = windowActiveForCount ? existingPending!.sendCount + 1 : 1;

  // Overwriting (upsert) the single row per (userId, channel) is what
  // invalidates any previously-issued OTP for this channel — a resend or a
  // fresh change request both make the old code permanently unusable.
  await prisma.pendingContactVerification.upsert({
    where: { userId_channel: { userId, channel } },
    update: {
      pendingValue: normalized,
      otpHash,
      otpSalt: salt,
      expiresAt,
      attempts: 0,
      lastSentAt: now,
      sendCount,
      windowStartedAt,
    },
    create: {
      userId,
      channel,
      pendingValue: normalized,
      otpHash,
      otpSalt: salt,
      expiresAt,
      lastSentAt: now,
      sendCount: 1,
      windowStartedAt: now,
    },
  });

  const sendResult = channel === "EMAIL" ? await sendOtpEmail(normalized, otp) : await sendOtpSms(normalized, otp);
  if (!sendResult.ok) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: "We couldn't send the verification code. Please try again shortly.",
    };
  }

  return {
    ok: true,
    maskedTarget: channel === "EMAIL" ? maskEmail(normalized) : maskPhone(normalized),
    expiresAt,
    resendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS),
  };
}

/**
 * Verifies `otp` for `userId`'s pending `channel` change. On success, commits
 * the new value to the live User row (and marks it verified) in a single
 * transaction with deleting the pending row (single-use enforcement).
 */
export async function verifyContactChange(
  userId: string,
  channel: ContactVerificationChannel,
  otp: string
): Promise<VerifyResult> {
  const pending = await prisma.pendingContactVerification.findUnique({
    where: { userId_channel: { userId, channel } },
  });

  if (!pending) {
    return { ok: false, code: "NOT_FOUND", message: "No pending verification found. Please start again." };
  }

  const now = new Date();
  if (isExpired(pending.expiresAt, now)) {
    await prisma.pendingContactVerification.delete({ where: { id: pending.id } }).catch(() => {});
    return { ok: false, code: "EXPIRED", message: "This code has expired. Please request a new one." };
  }

  if (pending.attempts >= MAX_VERIFY_ATTEMPTS) {
    await prisma.pendingContactVerification.delete({ where: { id: pending.id } }).catch(() => {});
    return {
      ok: false,
      code: "TOO_MANY_ATTEMPTS",
      message: "Too many incorrect attempts. Please request a new code.",
    };
  }

  const isValid = verifyOtpHash(otp, pending.otpHash, pending.otpSalt);
  if (!isValid) {
    await prisma.pendingContactVerification.update({
      where: { id: pending.id },
      data: { attempts: { increment: 1 } },
    });
    const remaining = MAX_VERIFY_ATTEMPTS - (pending.attempts + 1);
    return {
      ok: false,
      code: "INVALID_OTP",
      message:
        remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
          : "Incorrect code. Please request a new one.",
    };
  }

  // Re-check for a conflict at verification time too (another account may
  // have claimed the value in between send and verify).
  if (await findConflictingUser(channel, pending.pendingValue, userId)) {
    await prisma.pendingContactVerification.delete({ where: { id: pending.id } }).catch(() => {});
    return {
      ok: false,
      code: "CONFLICT",
      message: `This ${otpTargetLabel(channel)} can't be used. Please try a different one.`,
    };
  }

  const updateData =
    channel === "EMAIL"
      ? { email: pending.pendingValue, emailVerifiedAt: now }
      : { phone: pending.pendingValue, phoneVerifiedAt: now };

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: updateData }),
    // Single-use: delete immediately on success so the same OTP/row can
    // never be replayed.
    prisma.pendingContactVerification.delete({ where: { id: pending.id } }),
  ]);

  return { ok: true, value: pending.pendingValue };
}

/** Cancels a pending change (spec §2.7/§3.7 "cancelled -> keep existing value unchanged"). */
export async function cancelContactChange(userId: string, channel: ContactVerificationChannel): Promise<void> {
  await prisma.pendingContactVerification.deleteMany({ where: { userId, channel } });
}

export type PendingStatus = {
  pending: boolean;
  maskedTarget?: string;
  expiresAt?: Date;
  resendAvailableAt?: Date;
};

/** Read-only status used to resume/show an in-flight verification (e.g. after a page reload). */
export async function getPendingStatus(userId: string, channel: ContactVerificationChannel): Promise<PendingStatus> {
  const pending = await prisma.pendingContactVerification.findUnique({
    where: { userId_channel: { userId, channel } },
  });
  if (!pending || isExpired(pending.expiresAt)) {
    return { pending: false };
  }
  return {
    pending: true,
    maskedTarget: channel === "EMAIL" ? maskEmail(pending.pendingValue) : maskPhone(pending.pendingValue),
    expiresAt: pending.expiresAt,
    resendAvailableAt: new Date(pending.lastSentAt.getTime() + RESEND_COOLDOWN_MS),
  };
}

export { RESEND_COOLDOWN_MS };
