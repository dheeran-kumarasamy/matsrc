// Per-user, per-channel rate limiting for OTP verification ATTEMPTS on the
// /profile change-email/change-phone flow. Follows the exact same
// documented, deliberately-scoped in-process sliding-window pattern as
// apps/web/lib/sourcing/rate-limit.ts (this repo has no shared Redis-backed
// limiter on the apps/web side — ioredis/bullmq exist only in apps/api).
//
// This limiter guards the VERIFY endpoint (repeated OTP-guessing calls);
// OTP SEND/RESEND is separately rate-limited via the
// PendingContactVerification row's own sendCount/windowStartedAt columns
// (see service.ts), since that needs to be durable across serverless
// instances/cold starts for the same reason `lastSentAt` is persisted rather
// than kept only in memory.
//
// LIMITATION (stated plainly): on a multi-instance/serverless deployment
// each instance keeps its own counter, so this in-memory guard is a
// best-effort first line of defence layered on top of the persisted,
// DB-backed send-side limits — not a claim of global enforcement by itself.

export const MAX_VERIFY_CALLS_PER_WINDOW = 10;
export const VERIFY_RATE_LIMIT_WINDOW_MS = 5 * 60_000;

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 5000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

function key(userId: string, channel: string): string {
  return `${userId}:${channel}`;
}

/** Records a verify-attempt call and reports whether it is allowed. */
export function checkVerifyRateLimit(userId: string, channel: string, now = Date.now()): RateLimitResult {
  if (buckets.size > MAX_TRACKED_KEYS) {
    buckets.clear();
  }

  const bucketKey = key(userId, channel);
  const bucket = buckets.get(bucketKey) ?? { timestamps: [] };
  const windowStart = now - VERIFY_RATE_LIMIT_WINDOW_MS;
  const recent = bucket.timestamps.filter((timestamp) => timestamp > windowStart);

  if (recent.length >= MAX_VERIFY_CALLS_PER_WINDOW) {
    buckets.set(bucketKey, { timestamps: recent });
    const oldest = Math.min(...recent);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + VERIFY_RATE_LIMIT_WINDOW_MS - now),
    };
  }

  recent.push(now);
  buckets.set(bucketKey, { timestamps: recent });

  return {
    allowed: true,
    remaining: MAX_VERIFY_CALLS_PER_WINDOW - recent.length,
    retryAfterMs: 0,
  };
}

/** Test helper — clears all buckets. */
export function resetVerifyRateLimits(): void {
  buckets.clear();
}
