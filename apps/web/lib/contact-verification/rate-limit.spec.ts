import { describe, it, expect, beforeEach } from "vitest";
import { checkVerifyRateLimit, resetVerifyRateLimits, MAX_VERIFY_CALLS_PER_WINDOW } from "./rate-limit";

describe("checkVerifyRateLimit", () => {
  beforeEach(() => {
    resetVerifyRateLimits();
  });

  it("allows calls up to the max and then blocks further attempts (brute-force guard)", () => {
    const userId = "user-1";
    const now = Date.now();
    for (let i = 0; i < MAX_VERIFY_CALLS_PER_WINDOW; i++) {
      const result = checkVerifyRateLimit(userId, "EMAIL", now);
      expect(result.allowed).toBe(true);
    }
    const blocked = checkVerifyRateLimit(userId, "EMAIL", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks separate counters per channel for the same user", () => {
    const userId = "user-2";
    const now = Date.now();
    for (let i = 0; i < MAX_VERIFY_CALLS_PER_WINDOW; i++) {
      checkVerifyRateLimit(userId, "EMAIL", now);
    }
    // PHONE channel is unaffected by EMAIL's exhausted bucket.
    expect(checkVerifyRateLimit(userId, "PHONE", now).allowed).toBe(true);
  });

  it("tracks separate counters per user", () => {
    const now = Date.now();
    for (let i = 0; i < MAX_VERIFY_CALLS_PER_WINDOW; i++) {
      checkVerifyRateLimit("user-a", "EMAIL", now);
    }
    expect(checkVerifyRateLimit("user-b", "EMAIL", now).allowed).toBe(true);
  });
});
