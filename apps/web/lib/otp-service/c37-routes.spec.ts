// Route-level tests for C37 (PO Approval OTP) send-otp / approve — Prisma,
// auth context, and the OTP service are mocked; no real database/network
// calls. Placed under lib/ to match vitest.config.ts's include pattern.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseOrderStatus } from "@matsrc/db";

const getUserCtx = vi.fn((..._args: unknown[]) => ({ userId: "user-1", email: "builder@example.com", name: "Builder" }));
const getOrCreateBuilder = vi.fn(async (..._args: unknown[]) => ({ id: "user-1", email: "builder@example.com", name: "Builder" }));
const purchaseOrderFindFirst = vi.fn();
const purchaseOrderUpdate = vi.fn();
const auditLogCreate = vi.fn(async (..._args: unknown[]) => ({}));

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    purchaseOrder: {
      findFirst: (...args: unknown[]) => purchaseOrderFindFirst(...args),
      update: (...args: unknown[]) => purchaseOrderUpdate(...args),
    },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
  },
  getOrCreateBuilder: (...args: unknown[]) => getOrCreateBuilder(...args),
  getUserCtx: (...args: unknown[]) => getUserCtx(...args),
}));

vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<any>("@matsrc/db");
  return {
    ...actual,
    notifySupplierPoReceived: vi.fn(async () => undefined),
  };
});

const issueOtpChallenge = vi.fn();
const verifyOtpChallenge = vi.fn();
const deliverOtp = vi.fn();
const checkOtpSendRateLimit = vi.fn((..._args: unknown[]) => ({ allowed: true, remaining: 10, retryAfterMs: 0 }));
const checkOtpVerifyRateLimit = vi.fn((..._args: unknown[]) => ({ allowed: true, remaining: 10, retryAfterMs: 0 }));

vi.mock("@/lib/otp-service", () => ({
  issueOtpChallenge: (...args: unknown[]) => issueOtpChallenge(...args),
  verifyOtpChallenge: (...args: unknown[]) => verifyOtpChallenge(...args),
  deliverOtp: (...args: unknown[]) => deliverOtp(...args),
  checkOtpSendRateLimit: (...args: unknown[]) => checkOtpSendRateLimit(...args),
  checkOtpVerifyRateLimit: (...args: unknown[]) => checkOtpVerifyRateLimit(...args),
}));

function makeRequest(body: unknown): any {
  return {
    json: async () => body,
    headers: new Headers(),
  };
}

function fakePo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "po-1",
    status: PurchaseOrderStatus.DRAFT,
    poNumber: "PO-2026-00001",
    builderId: "user-1",
    supplierId: "sup-1",
    orderId: "order-1",
    builder: { id: "user-1", email: "builder@example.com", phone: null, name: "Builder" },
    supplier: { id: "sup-1", companyName: "Acme", user: { whatsappNumber: null, phone: null } },
    lineItems: [],
    order: { enquiryId: "EQ-1" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserCtx.mockReturnValue({ userId: "user-1", email: "builder@example.com", name: "Builder" });
  getOrCreateBuilder.mockResolvedValue({ id: "user-1", email: "builder@example.com", name: "Builder" });
  checkOtpSendRateLimit.mockReturnValue({ allowed: true, remaining: 10, retryAfterMs: 0 });
  checkOtpVerifyRateLimit.mockReturnValue({ allowed: true, remaining: 10, retryAfterMs: 0 });
});

describe("POST /purchase-orders/[id]/send-otp (C37)", () => {
  it("requires authentication", async () => {
    getUserCtx.mockImplementation(() => {
      throw new Error("UNAUTHENTICATED");
    });

    const { POST } = await import("@/app/api/builder/purchase-orders/[id]/send-otp/route");
    const res = await POST(makeRequest({}), { params: { id: "po-1" } });

    expect(res.status).toBe(500);
  });

  it("404s when the PO does not belong to the authenticated user", async () => {
    purchaseOrderFindFirst.mockResolvedValue(null);

    const { POST } = await import("@/app/api/builder/purchase-orders/[id]/send-otp/route");
    const res = await POST(makeRequest({}), { params: { id: "po-1" } });

    expect(res.status).toBe(404);
  });

  it("generates a PO-scoped OTP and MSG91 stub does not claim SMS delivery", async () => {
    purchaseOrderFindFirst.mockResolvedValue(fakePo());
    issueOtpChallenge.mockResolvedValue({ ok: true, challengeId: "c1", otp: "123456", expiresAt: new Date() });
    deliverOtp.mockResolvedValue({ ok: true, channel: "EMAIL", maskedTarget: "bu***@example.com" });

    const { POST } = await import("@/app/api/builder/purchase-orders/[id]/send-otp/route");
    const res = await POST(makeRequest({}), { params: { id: "po-1" } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.channel).toBe("EMAIL");
    expect(issueOtpChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "PO_APPROVAL_OTP", purchaseOrderId: "po-1", userId: "user-1" })
    );
  });
});

describe("POST /purchase-orders/[id]/approve (C37)", () => {
  it("rejects a syntactically invalid OTP before any verification call", async () => {
    const { POST } = await import("@/app/api/builder/purchase-orders/[id]/approve/route");
    const res = await POST(makeRequest({ otp: "12" }), { params: { id: "po-1" } });

    expect(res.status).toBe(400);
    expect(verifyOtpChallenge).not.toHaveBeenCalled();
  });

  it("approves the correct PO with the correct OTP", async () => {
    purchaseOrderFindFirst.mockResolvedValue(fakePo());
    verifyOtpChallenge.mockResolvedValue({ ok: true, userId: "user-1", identifier: "builder@example.com" });
    purchaseOrderUpdate.mockResolvedValue(fakePo({ status: PurchaseOrderStatus.ISSUED }));

    const { POST } = await import("@/app/api/builder/purchase-orders/[id]/approve/route");
    const res = await POST(makeRequest({ otp: "123456" }), { params: { id: "po-1" } });

    expect(res.status).toBe(200);
    expect(verifyOtpChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "PO_APPROVAL_OTP", purchaseOrderId: "po-1", userId: "user-1" }),
      "123456"
    );
    expect(purchaseOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: PurchaseOrderStatus.ISSUED }) })
    );
  });

  it("rejects an incorrect OTP and leaves the PO unchanged", async () => {
    purchaseOrderFindFirst.mockResolvedValue(fakePo());
    verifyOtpChallenge.mockResolvedValue({ ok: false, code: "INVALID_OTP", message: "Incorrect OTP." });

    const { POST } = await import("@/app/api/builder/purchase-orders/[id]/approve/route");
    const res = await POST(makeRequest({ otp: "999999" }), { params: { id: "po-1" } });

    expect(res.status).toBe(401);
    expect(purchaseOrderUpdate).not.toHaveBeenCalled();
  });

  it("rejects an OTP for another PO (verification scoped to this exact purchaseOrderId)", async () => {
    purchaseOrderFindFirst.mockResolvedValue(fakePo({ id: "po-2" }));
    verifyOtpChallenge.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "No active OTP found." });

    const { POST } = await import("@/app/api/builder/purchase-orders/[id]/approve/route");
    const res = await POST(makeRequest({ otp: "123456" }), { params: { id: "po-2" } });

    expect(res.status).toBe(400);
    expect(verifyOtpChallenge).toHaveBeenCalledWith(expect.objectContaining({ purchaseOrderId: "po-2" }), "123456");
    expect(purchaseOrderUpdate).not.toHaveBeenCalled();
  });

  it("rejects approval when the PO belongs to a different builder (ownership check)", async () => {
    purchaseOrderFindFirst.mockResolvedValue(null);

    const { POST } = await import("@/app/api/builder/purchase-orders/[id]/approve/route");
    const res = await POST(makeRequest({ otp: "123456" }), { params: { id: "po-1" } });

    expect(res.status).toBe(404);
    expect(verifyOtpChallenge).not.toHaveBeenCalled();
  });

  it("rejects an expired OTP", async () => {
    purchaseOrderFindFirst.mockResolvedValue(fakePo());
    verifyOtpChallenge.mockResolvedValue({ ok: false, code: "EXPIRED", message: "This OTP has expired." });

    const { POST } = await import("@/app/api/builder/purchase-orders/[id]/approve/route");
    const res = await POST(makeRequest({ otp: "123456" }), { params: { id: "po-1" } });

    expect(res.status).toBe(400);
    expect(purchaseOrderUpdate).not.toHaveBeenCalled();
  });

  it("rejects approval of a non-DRAFT PO regardless of OTP validity", async () => {
    purchaseOrderFindFirst.mockResolvedValue(fakePo({ status: PurchaseOrderStatus.ISSUED }));

    const { POST } = await import("@/app/api/builder/purchase-orders/[id]/approve/route");
    const res = await POST(makeRequest({ otp: "123456" }), { params: { id: "po-1" } });

    expect(res.status).toBe(400);
    expect(verifyOtpChallenge).not.toHaveBeenCalled();
  });
});
