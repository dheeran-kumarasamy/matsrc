// API-level test for POST /api/builder/orders/[id]/payment-proof — Product-
// Level GST / GST-Inclusive Buyer Payable (Phase 4) regression check.
//
// This route does not compute the outstanding amount itself — it delegates
// entirely to computeOrderOutstandingAmount (apps/web/lib/order-outstanding.ts),
// which now resolves the GST-inclusive finalPayableAmount when present. This
// test confirms that wiring end-to-end: the declared bank-transfer amount
// must be the GST-inclusive outstanding figure, not the GST-exclusive
// totalAmount.

import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindFirst = vi.fn();
const orderFindUnique = vi.fn();
const orderUpdate = vi.fn();
const paymentVerificationFindUnique = vi.fn();
const paymentVerificationCreate = vi.fn();
const paymentVerificationUpdate = vi.fn();
const orderTrackingCreate = vi.fn();
const customerAdvanceTransactionFindMany = vi.fn().mockResolvedValue([]);
const advanceReservationFindUnique = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    order: {
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
      findUnique: (...args: unknown[]) => orderFindUnique(...args),
      update: (...args: unknown[]) => orderUpdate(...args),
    },
    paymentVerification: {
      findUnique: (...args: unknown[]) => paymentVerificationFindUnique(...args),
      create: (...args: unknown[]) => paymentVerificationCreate(...args),
      update: (...args: unknown[]) => paymentVerificationUpdate(...args),
    },
    orderTracking: { create: (...args: unknown[]) => orderTrackingCreate(...args) },
    customerAdvanceTransaction: { findMany: (...args: unknown[]) => customerAdvanceTransactionFindMany(...args) },
    advanceReservation: { findUnique: (...args: unknown[]) => advanceReservationFindUnique(...args) },
  },
  getOrCreateBuilder: async (userId: string) => ({ id: userId }),
  getUserCtx: (request: Request) => {
    const userId = request.headers.get("X-User-Id");
    const email = request.headers.get("X-User-Email");
    if (!userId || !email) throw new Error("UNAUTHENTICATED");
    return { userId, email, name: "Builder" };
  },
}));

vi.mock("@/lib/notify", () => ({ notifyPaymentProofSubmitted: vi.fn() }));
vi.mock("@/lib/payment-proof-validation", () => ({
  validatePaymentProofFile: () => ({ valid: true }),
  buildSafePaymentProofFileName: (_orderId: string, name: string) => name,
}));

function makeRequest(): Request {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "proof.jpg", { type: "image/jpeg" }));
  return new Request("http://localhost/api/builder/orders/order-1/payment-proof", {
    method: "POST",
    headers: { "X-User-Id": "owner", "X-User-Email": "owner@example.com" },
    body: form,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  customerAdvanceTransactionFindMany.mockResolvedValue([]);
  advanceReservationFindUnique.mockResolvedValue(null);
  paymentVerificationFindUnique.mockResolvedValue(null);
  orderUpdate.mockResolvedValue({});
  orderTrackingCreate.mockResolvedValue({});
  paymentVerificationCreate.mockResolvedValue({ id: "pv-1" });
  const notifyModule: any = await import("@/lib/notify");
  notifyModule.notifyPaymentProofSubmitted.mockResolvedValue(undefined);
});

describe("POST /api/builder/orders/[id]/payment-proof — Phase 4 GST-inclusive declared amount", () => {
  it("declares the GST-inclusive outstanding amount (finalPayableAmount) for a confirmed order", async () => {
    orderFindFirst.mockResolvedValue({
      id: "order-1",
      paymentMethod: "BANK_TRANSFER",
      paymentStatus: "PENDING",
      totalAmount: 10000,
      status: "PROCESSING",
    });
    orderFindUnique.mockResolvedValue({
      totalAmount: 10000,
      taxAmount: 1800,
      finalPayableAmount: 11800,
      advancePercent: null,
      requiredAdvanceAmount: null,
    });

    const { POST } = await import("../app/api/builder/orders/[id]/payment-proof/route");
    const response = await POST(makeRequest(), { params: { id: "order-1" } });

    expect(response.status).toBe(201);
    expect(paymentVerificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 11800 }) })
    );
  });

  it("falls back to the GST-exclusive totalAmount for a legacy order", async () => {
    orderFindFirst.mockResolvedValue({
      id: "order-1",
      paymentMethod: "BANK_TRANSFER",
      paymentStatus: "PENDING",
      totalAmount: 5000,
      status: "PROCESSING",
    });
    orderFindUnique.mockResolvedValue({
      totalAmount: 5000,
      taxAmount: null,
      finalPayableAmount: null,
      advancePercent: null,
      requiredAdvanceAmount: null,
    });

    const { POST } = await import("../app/api/builder/orders/[id]/payment-proof/route");
    const response = await POST(makeRequest(), { params: { id: "order-1" } });

    expect(response.status).toBe(201);
    expect(paymentVerificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 5000 }) })
    );
  });
});
