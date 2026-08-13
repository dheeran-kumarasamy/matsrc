// Per-user rate limiting for the LLM-hitting sourcing endpoint (§20).
//
// WHY IN-PROCESS: this repo has no shared rate-limit table or Redis-backed
// limiter on the apps/web side (ioredis/bullmq exist only in apps/api), and the
// closest existing precedent — market-insight.ts's manual-refresh cooldown —
// likewise enforces its limit with a simple timestamp check rather than new
// infrastructure. This keeps the abuse guard honest about its scope: it protects
// a single server instance from a runaway client loop.
//
// LIMITATION (stated plainly rather than hidden): on a multi-instance/serverless
// deployment each instance keeps its own counter, so the effective limit is
// per-instance. A distributed limiter is the correct future step; this is a
// deliberate, documented first line of defence, not a claim of global enforcement.

/** Max sourcing messages per user per window. */
export const MAX_MESSAGES_PER_WINDOW = 12;

/** Sliding window length. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

/** Bounds map growth if many distinct users are seen. */
const MAX_TRACKED_USERS = 5000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

/**
 * Records an attempt for `userId` and reports whether it is allowed.
 *
 * Uses a sliding window: timestamps outside the window are dropped before the
 * count is checked, so a user is never permanently locked out.
 */
export function checkRateLimit(userId: string, now = Date.now()): RateLimitResult {
  if (buckets.size > MAX_TRACKED_USERS) {
    buckets.clear();
  }

  const bucket = buckets.get(userId) ?? { timestamps: [] };
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = bucket.timestamps.filter((timestamp) => timestamp > windowStart);

  if (recent.length >= MAX_MESSAGES_PER_WINDOW) {
    buckets.set(userId, { timestamps: recent });
    const oldest = Math.min(...recent);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + RATE_LIMIT_WINDOW_MS - now),
    };
  }

  recent.push(now);
  buckets.set(userId, { timestamps: recent });

  return {
    allowed: true,
    remaining: MAX_MESSAGES_PER_WINDOW - recent.length,
    retryAfterMs: 0,
  };
}

/** Test helper — clears all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}
