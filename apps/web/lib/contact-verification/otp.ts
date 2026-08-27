import { randomInt, randomBytes, scryptSync, timingSafeEqual } from "crypto";

// Core OTP generation/hashing primitives for the /profile email + phone
// change-verification flow (see docs comment on the PendingContactVerification
// Prisma model). Deliberately dependency-free (Node's built-in `crypto`) —
// this repo has no existing OTP-hashing helper to reuse, and pulling in
// bcrypt/argon2 for a 6-digit numeric code would be new infrastructure for
// no real security gain over scrypt with a per-row random salt.
//
// SECURITY NOTES (see task spec §4):
//  - OTPs are generated with crypto.randomInt (CSPRNG-backed), never Math.random.
//  - Only a salted scrypt hash is ever persisted — the plaintext OTP is
//    returned once (to be sent to the user) and never logged or stored.
//  - Comparison uses timingSafeEqual to avoid timing side-channels.

/** OTP length — 6 digits, matching the existing verify-otp/verify-mfa UI convention. */
export const OTP_LENGTH = 6;

/** OTP validity window. */
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Minimum time between an OTP send and the next allowed resend. */
export const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

/** Max failed verification attempts against a single pending OTP before it is locked out (must resend). */
export const MAX_VERIFY_ATTEMPTS = 5;

/** Max OTP sends (initial + resends) allowed per rolling window, per user+channel. */
export const MAX_SENDS_PER_WINDOW = 5;
export const SEND_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const SCRYPT_KEYLEN = 64;

/** Generates a cryptographically secure numeric OTP of OTP_LENGTH digits (never starts trimmed — zero-padded). */
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

/**
 * Constant-time comparison of a candidate OTP against a stored hash+salt.
 * Never short-circuits on length/content in a way that leaks timing info
 * about how much of the OTP matched.
 */
export function verifyOtpHash(candidateOtp: string, storedHash: string, salt: string): boolean {
  if (!/^\d{6}$/.test(candidateOtp)) return false;
  const candidateHash = hashOtp(candidateOtp, salt);
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True if `expiresAt` is in the past. */
export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** Computes the expiry timestamp for a freshly generated OTP. */
export function computeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_TTL_MS);
}
