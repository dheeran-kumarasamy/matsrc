import { checkVerifyRateLimit, type RateLimitResult } from "@/lib/contact-verification/rate-limit";

// Rate limiting for C20/C37 OTP verification ATTEMPTS, by (identifier,
// purpose) — reuses the EXISTING in-process sliding-window limiter
// (apps/web/lib/contact-verification/rate-limit.ts) rather than introducing
// a second, incompatible rate-limiting mechanism, per the task spec's
// "Reuse existing rate-limiting infrastructure if available" requirement.
// The underlying `checkVerifyRateLimit(key, scope)` function is generic
// over its two string arguments — passing `purpose` as the second argument
// keeps C20 (LOGIN_OTP) and C37 (PO_APPROVAL_OTP) verify-attempt counters
// fully independent of each other and of the unrelated Profile
// contact-verification feature's own usage of the same limiter (which uses
// `channel` — "EMAIL"/"PHONE" — as its second argument, a disjoint keyspace
// from "LOGIN_OTP"/"PO_APPROVAL_OTP").
//
// OTP SEND-side rate limiting is already enforced durably (survives
// restarts/multi-instance) by the MAX_SENDS_PER_WINDOW / SEND_WINDOW_MS
// logic inside issueOtpChallenge() (./challenge.ts), which persists
// sendCount/createdAt on the OtpChallenge row itself — this in-memory
// limiter only adds an additional, best-effort IP-based throttle on top,
// exactly mirroring the documented limitation already called out in
// contact-verification/rate-limit.ts (per-instance, not a global guarantee).

const sendBuckets = new Map<string, number[]>();
const MAX_TRACKED_SEND_KEYS = 5000;
const MAX_SEND_CALLS_PER_IP_WINDOW = 20;
const SEND_IP_WINDOW_MS = 15 * 60_000;

export type OtpRateLimitResult = RateLimitResult;

/** Verify-attempt rate limiting, scoped by (identifier, purpose). */
export function checkOtpVerifyRateLimit(identifier: string, purpose: string): OtpRateLimitResult {
  return checkVerifyRateLimit(identifier, purpose);
}

/**
 * Best-effort, per-IP send-rate throttle (supplementary to the durable,
 * per-scope limit already enforced inside issueOtpChallenge()). `ip` may be
 * null when unavailable (e.g. some server environments) — in that case this
 * check is skipped entirely rather than throttling by a shared/empty key.
 */
export function checkOtpSendRateLimit(ip: string | null, now = Date.now()): OtpRateLimitResult {
  if (!ip) {
    return { allowed: true, remaining: MAX_SEND_CALLS_PER_IP_WINDOW, retryAfterMs: 0 };
  }

  if (sendBuckets.size > MAX_TRACKED_SEND_KEYS) {
    sendBuckets.clear();
  }

  const windowStart = now - SEND_IP_WINDOW_MS;
  const recent = (sendBuckets.get(ip) ?? []).filter((t) => t > windowStart);

  if (recent.length >= MAX_SEND_CALLS_PER_IP_WINDOW) {
    sendBuckets.set(ip, recent);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, Math.min(...recent) + SEND_IP_WINDOW_MS - now),
    };
  }

  recent.push(now);
  sendBuckets.set(ip, recent);
  return { allowed: true, remaining: MAX_SEND_CALLS_PER_IP_WINDOW - recent.length, retryAfterMs: 0 };
}
