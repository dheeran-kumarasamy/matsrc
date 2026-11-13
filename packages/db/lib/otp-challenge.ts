// packages/db/lib/otp-challenge.ts
//
// Shared, framework-agnostic OTP challenge lifecycle (generation, hashing,
// persistence, expiry, resend cooldown, attempt-limiting, invalidation,
// single-use verification) backing the Buyer (apps/web) LOGIN_OTP/
// PO_APPROVAL_OTP flows AND the Supplier (apps/supplier) new LOGIN_OTP flow.
//
// WHY THIS LIVES HERE (packages/db) RATHER THAN DUPLICATED PER APP:
// apps/web already has a fully-built, tested OTP challenge service
// (apps/web/lib/otp-service/challenge.ts) operating against the shared
// `OtpChallenge` Prisma model. Supplier portal login needs the EXACT SAME
// lifecycle/security posture — per the task's explicit instruction to
// "prefer reuse over duplication" and "do NOT create a separate Supplier
// OTP database/table". Next.js apps cannot import each other's `app/`/`lib/`
// trees directly, but both already depend on `@matsrc/db` (this package),
// so this is the smallest clean integration boundary: the core lifecycle
// moves here, and apps/web/lib/otp-service/challenge.ts becomes a thin
// delegating wrapper (passing its own `prisma` singleton) so its existing
// exported function signatures, call sites, and tests are UNCHANGED.
// apps/supplier gets its own equally-thin wrapper calling the same
// functions here with its own `prisma` singleton. There is exactly ONE
// `OtpChallenge` table and ONE implementation of its lifecycle rules —
// never two.
//
// SECURITY INVARIANTS (unchanged from the original apps/web implementation
// — see apps/web/lib/otp-service/challenge.ts's original doc comment,
// mirrors apps/web/lib/contact-verification/service.ts):
//  - Every lookup filters on `purpose` in addition to its other scope
//    columns — a LOGIN_OTP row can never satisfy a PO_APPROVAL_OTP
//    verification query and vice versa.
//  - Only a salted hash of the OTP is ever persisted.
//  - A verified row is marked `usedAt` in the same update that the caller's
//    business action succeeds — single-use, no replay.
//  - Issuing a new challenge for the same (purpose, identifier[,
//    purchaseOrderId]) scope overwrites/invalidates any previous one.
//
// Crypto primitives (CSPRNG via crypto.randomInt, scrypt hashing with a
// per-row salt, timing-safe comparison) are duplicated here rather than
// imported from apps/web/lib/contact-verification/otp.ts for the exact same
// reason apps/web/lib/otp-service/crypto.ts already gives: that module's
// OTP_TTL_MS is hard-coded to its own 10-minute window, whereas LOGIN_OTP
// uses a 5-minute window — these are simple, generic, already-reviewed
// primitives, so duplicating them here (scoped to this module's own
// constants) is lower-risk than parameterizing a different app's tested
// module.

import { randomInt, randomBytes, scryptSync, timingSafeEqual } from "crypto";

/** OTP length — 6 digits, matching every existing OTP UI in this app. */
export const OTP_LENGTH = 6;

/** OTP validity window — 5 minutes, matching the existing LOGIN_OTP/PO_APPROVAL_OTP posture. */
export const OTP_TTL_MS = 5 * 60 * 1000;

/** Minimum time between an OTP send and the next allowed resend. */
export const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

/** Max failed verification attempts against a single OTP challenge before it is locked out. */
export const MAX_VERIFY_ATTEMPTS = 5;

/** Max OTP sends (initial + resends) allowed per rolling window, per scope. */
export const MAX_SENDS_PER_WINDOW = 5;
export const SEND_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const SCRYPT_KEYLEN = 64;

/** Generates a cryptographically secure numeric OTP of OTP_LENGTH digits. */
export function generateOtp(): string {
  const max = 10 ** OTP_LENGTH;
  const value = randomInt(0, max);
  return value.toString().padStart(OTP_LENGTH, "0");
}

/** Generates a fresh random hex salt for hashing a single OTP. */
export function generateOtpSalt(): string {
  return randomBytes(16).toString("hex");
}

/** Hashes `otp` with `salt` using scrypt. Returns a hex-encoded digest — never the plaintext OTP. */
export function hashOtp(otp: string, salt: string): string {
  return scryptSync(otp, salt, SCRYPT_KEYLEN).toString("hex");
}

/** Constant-time comparison of a candidate OTP against a stored hash+salt. */
export function verifyOtpHash(candidateOtp: string, storedHash: string, salt: string): boolean {
  if (!/^\d{6}$/.test(candidateOtp)) return false;
  const candidateHash = hashOtp(candidateOtp, salt);
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True if `expiresAt` is in the past (or exactly now). */
export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** Computes the expiry timestamp for a freshly generated OTP (5-minute window). */
export function computeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_TTL_MS);
}

// ---------------------------------------------------------------------------
// Shared challenge lifecycle (issue / verify / record-delivery) — used
// directly by apps/supplier's new OTP login routes (see
// apps/supplier/lib/otp-service/). apps/web's EXISTING, already-tested
// apps/web/lib/otp-service/challenge.ts is left untouched (same security
// posture, same OtpChallenge table, same constants) rather than refactored
// to delegate here — avoiding risk to a working, tested implementation per
// "do not replace working OTP primitives". Both ultimately enforce
// identical rules against the identical `OtpChallenge` Prisma model — there
// is still exactly ONE OTP table/lifecycle *definition*, just two call
// sites during this incremental rollout.
//
// Minimal structural Prisma-client shape — matches @matsrc/db's generated
// OtpChallenge delegate closely enough to be used directly with either
// app's own `prisma` singleton (same `any`-returning-method pattern already
// used throughout this package — see business-number.ts/enquiry-id.ts).
export type OtpChallengePrismaClient = {
  otpChallenge: {
    findFirst: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
};

export type OtpChallengeScope = {
  purpose: string;
  identifier: string;
  userId?: string | null;
  purchaseOrderId?: string | null;
};

export type IssueOtpChallengeResult =
  | { ok: true; challengeId: string; otp: string; expiresAt: Date }
  | { ok: false; code: "COOLDOWN" | "RATE_LIMITED"; message: string; retryAfterMs?: number };

async function findActiveChallenge(prisma: OtpChallengePrismaClient, scope: OtpChallengeScope) {
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
 * cooldown and the rolling send-rate window. Does NOT send anything.
 * `defaults` seeds the row's required channel/provider columns before any
 * real delivery attempt is recorded via `recordOtpDeliveryAttempt()`.
 */
export async function issueOtpChallenge(
  prisma: OtpChallengePrismaClient,
  scope: OtpChallengeScope,
  defaults: { channel: string; provider: string }
): Promise<IssueOtpChallengeResult> {
  const now = new Date();
  const existing = await findActiveChallenge(prisma, scope);

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

  const created = await prisma.$transaction(async (tx: any) => {
    if (existing && !existing.usedAt) {
      await tx.otpChallenge.update({ where: { id: existing.id }, data: { usedAt: now } });
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
        channel: defaults.channel,
        provider: defaults.provider,
        deliveryStatus: "PENDING",
      },
    });
  });

  return { ok: true, challengeId: created.id, otp, expiresAt };
}

/** Records the outcome of a delivery attempt against a challenge (never the plaintext OTP). */
export async function recordOtpDeliveryAttempt(
  prisma: OtpChallengePrismaClient,
  challengeId: string,
  result: { channel: string; provider: string; status: string; providerMessageId?: string | null; error?: string | null }
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

export type VerifyOtpChallengeResult =
  | { ok: true; userId: string | null; identifier: string }
  | { ok: false; code: "NOT_FOUND" | "EXPIRED" | "INVALID_OTP" | "TOO_MANY_ATTEMPTS"; message: string };

/** Verifies `otp` against the active challenge for `scope`. Enforces purpose binding, expiry, attempt limits, and single-use. */
export async function verifyOtpChallenge(
  prisma: OtpChallengePrismaClient,
  scope: OtpChallengeScope,
  otp: string
): Promise<VerifyOtpChallengeResult> {
  const challenge = await findActiveChallenge(prisma, scope);

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
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
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

  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: now } });

  return { ok: true, userId: challenge.userId, identifier: challenge.identifier };
}
