// API-level tests for POST /api/builder/orders/[id]/cancel (§7 of the PO
// quantity-change task spec). Prisma is mocked (same pattern as
// lib/sourcing/session-authorization.spec.ts) so this runs in the existing
// `lib/**/*.spec.ts` vitest suite with no real database — the test file
// lives under lib/ purely so vitest's `include` glob picks it up; it
// imports and exercises the actual route handler module directly.
//
// Covers:
//   - successful cancellation of a PLACED order (status -> CANCELLED,
//     OrderTracking row created, PurchaseOrder/PurchaseOrderLineItem never
//     touched)
//   - rejection for every non-PLACED status (PROCESSING/DISPATCHED/
//     OUT_FOR_DELIVERY/DELIVERED/CANCELLED)
//   - authorization: a builder cannot cancel another builder's order
//   - payment safety: paymentStatus/paymentRef are never written by this route

import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const orderTrackingCreate = vi.fn();
// Not exposed on the mocked client's normal write path — asserts the route
// module never even calls purchaseOrder/purchaseOrderLineItem writes, for
// PO-immutability (§10 of the route's own PO integrity guarantee).
const purchaseOrderUpdate = vi.fn();
const purchaseOrderLineItemUpdate = vi.fn();
// Advance Balance reservation release check (route now wraps the
// cancellation in a transaction and looks up the buyer's advance account —
// see Advance Balance Payment Lifecycle fix). No advance account by
// default, so the release logic is a no-op for every test in this file.
const customerAdvanceAccountFindFirst = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/builder-db", () => {
  const prisma: any = {
    order: {
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
      update: (...args: unknown[]) => orderUpdate(...args),
    },
    orderTracking: {
      create: (...args: unknown[]) => orderTrackingCreate(...args),
    },
    purchaseOrder: { update: (...args: unknown[]) => purchaseOrderUpdate(...args) },
    purchaseOrderLineItem: { update: (...args: unknown[]) => purchaseOrderLineItemUpdate(...args) },
    customerAdvanceAccount: {
      findFirst: (...args: unknown[]) => customerAdvanceAccountFindFirst(...args),
    },
  };
  // The route wraps its mutations in `prisma.$transaction(async (tx) => ...)`
  // — reuse the same mocked delegates as `tx` so existing assertions against
  // orderUpdate/orderTrackingCreate etc. keep working unchanged.
  prisma.$transaction = (callback: (tx: unknown) => unknown) => callback(prisma);

  return {
    prisma,
    getOrCreateBuilder: async (userId: string) => ({ id: userId }),
    getUserCtx: (request: Request) => {
      const headers = request.headers;
      const userId = headers.get("X-User-Id");
      const email = headers.get("X-User-Email");
      if (!userId || !email) {
        throw new Error("UNAUTHENTICATED");
      }
      return { userId, email, name: headers.get("X-User-Name") || "Builder" };
    },
  };
});

const OWNER = "builder-owner";
const ATTACKER = "builder-attacker";
const ORDER_ID = "order-1";

function makeRequest(userId: string, body: unknown = {}) {
  return new Request(`http://localhost/api/builder/orders/${ORDER_ID}/cancel`, {
    method: "POST",
    headers: { "X-User-Id": userId, "X-User-Email": `${userId}@example.com` },
    body: JSON.stringify(body),
  });
}

function orderRow(overrides: Partial<{ status: string; userId: string }> = {}) {
  return { id: ORDER_ID, status: "PLACED", userId: OWNER, paymentStatus: "PENDING", ...overrides };
}

beforeEach(() => {
  orderFindFirst.mockReset();
  orderUpdate.mockReset();
  orderTrackingCreate.mockReset();
  purchaseOrderUpdate.mockReset();
  purchaseOrderLineItemUpdate.mockReset();
  customerAdvanceAccountFindFirst.mockReset();
  customerAdvanceAccountFindFirst.mockResolvedValue(null);
});

describe("POST /api/builder/orders/[id]/cancel — successful cancellation", () => {
  it("cancels a PLACED order, writes the tracking row, and never touches the PurchaseOrder", async () => {
    const { POST } = await import("../app/api/builder/orders/[id]/cancel/route");

    orderFindFirst.mockImplementation(({ where }: any) =>
      where.userId === OWNER ? Promise.resolve(orderRow()) : Promise.resolve(null)
    );
    orderUpdate.mockResolvedValue({ id: ORDER_ID, status: "CANCELLED" });
    orderTrackingCreate.mockResolvedValue({});

    const response = await POST(makeRequest(OWNER), { params: { id: ORDER_ID } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: ORDER_ID, status: "CANCELLED" });

    // The order lookup is scoped by BOTH id and the caller's own userId.
    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ORDER_ID, userId: OWNER } })
    );

    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ORDER_ID }, data: { status: "CANCELLED" } })
    );

    expect(orderTrackingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: ORDER_ID, status: "CANCELLED" }),
      })
    );
    // "Cancelled by builder" baseline audit note preserved when no reason given.
    expect(orderTrackingCreate.mock.calls[0][0].data.note).toMatch(/cancelled by builder/i);

    // PO immutability: the route never calls purchaseOrder/purchaseOrderLineItem writes.
    expect(purchaseOrderUpdate).not.toHaveBeenCalled();
    expect(purchaseOrderLineItemUpdate).not.toHaveBeenCalled();
  });

  it("persists the chosen cancellation reason in the tracking note", async () => {
    const { POST } = await import("../app/api/builder/orders/[id]/cancel/route");

    orderFindFirst.mockResolvedValue(orderRow());
    orderUpdate.mockResolvedValue({ id: ORDER_ID, status: "CANCELLED" });
    orderTrackingCreate.mockResolvedValue({});

    const request = makeRequest(OWNER, { reason: "QUANTITY_CHANGED" });

    await POST(request, { params: { id: ORDER_ID } });

    const note = orderTrackingCreate.mock.calls[0][0].data.note as string;
    expect(note).toMatch(/cancelled by builder/i);
    expect(note).toMatch(/quantity changed/i);
  });
});

describe("POST /api/builder/orders/[id]/cancel — invalid status is rejected", () => {
  const ineligibleStatuses = ["PROCESSING", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

  it.each(ineligibleStatuses)("rejects cancellation when status is %s", async (status) => {
    const { POST } = await import("../app/api/builder/orders/[id]/cancel/route");

    orderFindFirst.mockResolvedValue(orderRow({ status }));

    const response = await POST(makeRequest(OWNER), { params: { id: ORDER_ID } });

    expect(response.status).toBe(400);
    // The existing status-transition rule is enforced, not a new one.
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(orderTrackingCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/builder/orders/[id]/cancel — authorization", () => {
  it("rejects cancellation of another builder's order", async () => {
    const { POST } = await import("../app/api/builder/orders/[id]/cancel/route");

    // Simulate the DB honouring the userId predicate — only OWNER's query matches.
    orderFindFirst.mockImplementation(({ where }: any) =>
      where.userId === OWNER ? Promise.resolve(orderRow()) : Promise.resolve(null)
    );

    const response = await POST(makeRequest(ATTACKER), { params: { id: ORDER_ID } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ORDER_ID, userId: ATTACKER } })
    );
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(orderTrackingCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/builder/orders/[id]/cancel — payment safety", () => {
  it("never writes payment fields for a cancelled PLACED order", async () => {
    const { POST } = await import("../app/api/builder/orders/[id]/cancel/route");

    orderFindFirst.mockResolvedValue(orderRow());
    orderUpdate.mockResolvedValue({ id: ORDER_ID, status: "CANCELLED" });
    orderTrackingCreate.mockResolvedValue({});

    await POST(makeRequest(OWNER), { params: { id: ORDER_ID } });

    // The update's `data` payload contains ONLY the status transition — no
    // paymentStatus/paymentRef/refund field is ever included.
    const updateArgs = orderUpdate.mock.calls[0][0];
    expect(updateArgs.data).toEqual({ status: "CANCELLED" });
  });
});
