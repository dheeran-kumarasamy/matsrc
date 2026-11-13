// Route-level tests for GET /api/builder/advance.
// Prisma and the auth context (resolveUserCtx/getOrCreateBuilder) are mocked;
// no real database/network calls. Placed under lib/ to match
// vitest.config.ts's include pattern ("lib/**/*.spec.ts").

import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveUserCtx = vi.fn(async (..._args: unknown[]) => ({
  userId: "user-1",
  email: "builder@example.com",
  name: "Builder",
}));
const getOrCreateBuilder = vi.fn(async (..._args: unknown[]) => ({
  id: "user-1",
  email: "builder@example.com",
  name: "Builder",
}));
const getOrCreateAdvanceAccount = vi.fn();
const customerAdvanceAccountFindUnique = vi.fn();
const advancePaymentAggregate = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    customerAdvanceAccount: {
      findUnique: (...args: unknown[]) => customerAdvanceAccountFindUnique(...args),
    },
    advancePayment: {
      aggregate: (...args: unknown[]) => advancePaymentAggregate(...args),
    },
  },
  getOrCreateBuilder: (...args: unknown[]) => getOrCreateBuilder(...args),
  resolveUserCtx: (...args: unknown[]) => resolveUserCtx(...args),
}));

vi.mock("@matsrc/db", () => ({
  getOrCreateAdvanceAccount: (...args: unknown[]) => getOrCreateAdvanceAccount(...args),
}));

function makeRequest(url = "https://example.com/api/builder/advance"): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveUserCtx.mockResolvedValue({
    userId: "user-1",
    email: "builder@example.com",
    name: "Builder",
  });
  getOrCreateBuilder.mockResolvedValue({
    id: "user-1",
    email: "builder@example.com",
    name: "Builder",
  });
  getOrCreateAdvanceAccount.mockResolvedValue({ id: "acct-1", buyerId: "user-1" });
  customerAdvanceAccountFindUnique.mockResolvedValue({
    id: "acct-1",
    currency: "INR",
    availableBalance: 25000,
    status: "ACTIVE",
  });
  advancePaymentAggregate.mockResolvedValue({
    _sum: { amount: 5000 },
  });
});

describe("GET /api/builder/advance", () => {
  it("returns availableBalance and pendingAdvance for authenticated buyer", async () => {
    const { GET } = await import("@/app/api/builder/advance/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      availableBalance: 25000,
      pendingAdvance: 5000,
      currency: "INR",
      status: "ACTIVE",
    });
    expect(getOrCreateAdvanceAccount).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("handles buyer with zero balance and null pending amount gracefully", async () => {
    customerAdvanceAccountFindUnique.mockResolvedValue({
      id: "acct-1",
      currency: "INR",
      availableBalance: 0,
      status: "ACTIVE",
    });
    advancePaymentAggregate.mockResolvedValue({
      _sum: { amount: null },
    });

    const { GET } = await import("@/app/api/builder/advance/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.availableBalance).toBe(0);
    expect(body.pendingAdvance).toBe(0);
  });

  it("returns 401 Unauthorized when resolveUserCtx throws UNAUTHENTICATED", async () => {
    resolveUserCtx.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const { GET } = await import("@/app/api/builder/advance/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(getOrCreateAdvanceAccount).not.toHaveBeenCalled();
  });

  it("returns 500 when an unexpected database error occurs", async () => {
    getOrCreateAdvanceAccount.mockRejectedValue(new Error("Database connection lost"));

    const { GET } = await import("@/app/api/builder/advance/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to fetch advance balance");
  });

  it("falls back to zero balance if fullAccount lookup returns null", async () => {
    customerAdvanceAccountFindUnique.mockResolvedValue(null);
    advancePaymentAggregate.mockResolvedValue({ _sum: { amount: null } });

    const { GET } = await import("@/app/api/builder/advance/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.availableBalance).toBe(0);
    expect(body.pendingAdvance).toBe(0);
    expect(body.currency).toBe("INR");
    expect(body.status).toBe("ACTIVE");
  });
});
