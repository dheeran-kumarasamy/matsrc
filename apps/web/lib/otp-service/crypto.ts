// Re-exports the proven, tested OTP cryptographic primitives from
// apps/web/lib/contact-verification/otp.ts (CSPRNG generation via
// crypto.randomInt, scrypt hashing with a per-row salt, timing-safe
// comparison) rather than duplicating them — these primitives are generic
// (not coupled to any particular TTL/purpose/storage shape), so they are
// safe to reuse as-is for the C20/C37 OtpChallenge model.
//
// Expiry helpers are intentionally NOT re-exported from there: that module's
// computeExpiry() is hard-coded to its own 10-minute OTP_TTL_MS, whereas
// C20/C37 use a 5-minute window (see ./constants.ts) per the implementation
// spec. Expiry is simple enough (`now + ttl`) that duplicating these two
// one-line helpers here, scoped to OTP_TTL_MS from ./constants.ts, is lower
// risk than parameterizing the existing, already-tested contact-verification
// module (which has its own passing test suite asserting its literal
// 10-minute behaviour).

import { generateOtp, generateOtpSalt, hashOtp, verifyOtpHash } from "@/lib/contact-verification/otp";
import { OTP_TTL_MS } from "./constants";

export { generateOtp, generateOtpSalt, hashOtp, verifyOtpHash };

/** True if `expiresAt` is in the past (or exactly now). */
export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** Computes the expiry timestamp for a freshly generated OTP (5-minute window). */
export function computeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_TTL_MS);
}
