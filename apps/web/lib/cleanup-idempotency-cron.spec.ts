import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const cleanupExpiredCartIdempotencies = vi.fn();

vi.mock("@/lib/cart-data", () => ({
  cleanupExpiredCartIdempotencies: (...args: unknown[]) =>
    cleanupExpiredCartIdempotencies(...args),
}));

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request(url, { headers }));
}

describe("GET /api/cron/cleanup-idempotency", () => {
  const originalEnv = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupExpiredCartIdempotencies.mockResolvedValue(5);
    process.env.CRON_SECRET = "super-secret-cron-token";
  });

  afterAll(() => {
    process.env.CRON_SECRET = originalEnv;
  });

  it("fails safely with 500 if CRON_SECRET is not configured on the server", async () => {
    delete process.env.CRON_SECRET;

    const { GET } = await import("@/app/api/cron/cleanup-idempotency/route");
    const req = makeRequest("https://example.com/api/cron/cleanup-idempotency", {
      authorization: "Bearer super-secret-cron-token",
    });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("CRON_SECRET is not configured on server");
    expect(cleanupExpiredCartIdempotencies).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header is missing completely", async () => {
    const { GET } = await import("@/app/api/cron/cleanup-idempotency/route");
    const req = makeRequest("https://example.com/api/cron/cleanup-idempotency");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
    expect(cleanupExpiredCartIdempotencies).not.toHaveBeenCalled();
  });

  it("returns 401 when Bearer token is invalid", async () => {
    const { GET } = await import("@/app/api/cron/cleanup-idempotency/route");
    const req = makeRequest("https://example.com/api/cron/cleanup-idempotency", {
      authorization: "Bearer wrong-secret-token",
    });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
    expect(cleanupExpiredCartIdempotencies).not.toHaveBeenCalled();
  });

  it("rejects query-string secrets without Bearer token (returns 401)", async () => {
    const { GET } = await import("@/app/api/cron/cleanup-idempotency/route");
    const req = makeRequest(
      "https://example.com/api/cron/cleanup-idempotency?secret=super-secret-cron-token"
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
    expect(cleanupExpiredCartIdempotencies).not.toHaveBeenCalled();
  });

  it("rejects query-string secrets when accompanied by invalid Bearer token", async () => {
    const { GET } = await import("@/app/api/cron/cleanup-idempotency/route");
    const req = makeRequest(
      "https://example.com/api/cron/cleanup-idempotency?secret=super-secret-cron-token",
      { authorization: "Bearer invalid-bearer" }
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Unauthorized");
    expect(cleanupExpiredCartIdempotencies).not.toHaveBeenCalled();
  });

  it("accepts valid Bearer token and executes cleanup with 7-day retention grace", async () => {
    const { GET } = await import("@/app/api/cron/cleanup-idempotency/route");
    const req = makeRequest("https://example.com/api/cron/cleanup-idempotency", {
      authorization: "Bearer super-secret-cron-token",
    });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.deletedCount).toBe(5);
    expect(cleanupExpiredCartIdempotencies).toHaveBeenCalledTimes(1);

    // Verify cutoff passed to cleanup function is roughly 7 days in the past
    const cutoffArg: Date = cleanupExpiredCartIdempotencies.mock.calls[0][0];
    const expectedCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffArg.getTime() - expectedCutoff)).toBeLessThan(5000);
  });

  it("handles runtime errors during cleanup and returns 500 safely", async () => {
    cleanupExpiredCartIdempotencies.mockRejectedValue(new Error("Database connection lost"));

    const { GET } = await import("@/app/api/cron/cleanup-idempotency/route");
    const req = makeRequest("https://example.com/api/cron/cleanup-idempotency", {
      authorization: "Bearer super-secret-cron-token",
    });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Internal server error");
  });
});
