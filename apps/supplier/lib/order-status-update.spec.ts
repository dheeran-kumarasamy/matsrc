// Focused test for updateSupplierOrderStatus's backend transition guard
// (lib/supplier-data.ts) — verifies that invalid supplier-triggered
// transitions are rejected at the data-layer level, independent of
// whatever the UI (OrderStatusActions.tsx) happens to render. Mocks
// @matsrc/db and this module's other external dependencies so no real
// database is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { orderRows, findUniqueCalls, updateCalls, notifyCustomerOrderStatusChanged, notifyPaymentRequired, waitUntilMock } = vi.hoisted(() => {
  const orderRows = new Map<string, { id: string; status: string; items: any[] }>();
  const findUniqueCalls: any[] = [];
  const updateCalls: any[] = [];
  const notifyCustomerOrderStatusChanged = vi.fn(() => Promise.resolve());
  const notifyPaymentRequired = vi.fn(() => Promise.resolve());
  // Mock of Vercel's waitUntil() — records every promise handed to it so
  // tests can assert the notification work is *scheduled* (kept alive past
  // the HTTP response) rather than fired off as a detached `void` promise
  // that Vercel's serverless runtime may kill before it settles.
  const waitUntilMock = vi.fn();
  return { orderRows, findUniqueCalls, updateCalls, notifyCustomerOrderStatusChanged, notifyPaymentRequired, waitUntilMock };
});

vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}));

vi.mock("@matsrc/db", () => {
  return {
    prisma: {
      order: {
        findUnique: vi.fn((args: any) => {
          findUniqueCalls.push(args);
          const row = orderRows.get(args.where.id);
          if (!row) return Promise.resolve(null);
          if (args.select) {
            const picked: any = {};
            for (const key of Object.keys(args.select)) picked[key] = (row as any)[key];
            return Promise.resolve(picked);
          }
          return Promise.resolve(row);
        }),
        update: vi.fn((args: any) => {
          updateCalls.push(args);
          const row = orderRows.get(args.where.id);
          const updated = { ...row, ...args.data };
          orderRows.set(args.where.id, updated as any);
          return Promise.resolve(updated);
        }),
      },
      orderTracking: {
        create: vi.fn(() => Promise.resolve({})),
      },
      orderItemSupplierCandidate: {
        update: vi.fn(() => Promise.resolve({})),
      },
      orderItem: {
        update: vi.fn(() => Promise.resolve({})),
      },
    },
    // customer_order_status Meta WhatsApp notification (Notification Engine
    // pipeline — see packages/db/lib/customer-order-status-notification.ts).
    // Spied directly (not re-implemented) so these tests assert exactly
    // what updateSupplierOrderStatus passes to it, without re-testing the
    // notification pipeline's own internals (covered separately in
    // packages/db/lib/customer-order-status-notification.spec.ts).
    notifyCustomerOrderStatusChanged,
    // payment_required Meta WhatsApp notification (PAYMENT_REQUIRED event —
    // see packages/db/lib/payment-required-notification.ts). Spied directly
    // for the same reason as notifyCustomerOrderStatusChanged above; its own
    // internals (PLACED -> PROCESSING + paymentStatus PENDING guard) are
    // covered separately in packages/db/lib/payment-required-notification.spec.ts.
    notifyPaymentRequired,
  };
});

vi.mock("./twilio-whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(() => Promise.resolve({})),
}));

import { updateSupplierOrderStatus } from "./supplier-data";

beforeEach(() => {
  orderRows.clear();
  findUniqueCalls.length = 0;
  updateCalls.length = 0;
  notifyCustomerOrderStatusChanged.mockClear();
  notifyPaymentRequired.mockClear();
  waitUntilMock.mockClear();
});

function seedOrder(id: string, status: string) {
  orderRows.set(id, { id, status, items: [] });
}

describe("updateSupplierOrderStatus — backend transition guard", () => {
  it("allows Confirm Enquiry (PLACED -> PROCESSING)", async () => {
    seedOrder("order-1", "PLACED");
    const result = await updateSupplierOrderStatus("order-1", "PROCESSING" as any);
    expect(result.status).toBe("PROCESSING");
  });

  it("rejects Confirm Enquiry after the enquiry has already been accepted", async () => {
    seedOrder("order-2", "PROCESSING");
    await expect(updateSupplierOrderStatus("order-2", "PROCESSING" as any)).rejects.toThrow(
      /Invalid order status transition/
    );
  });

  it("rejects Decline Enquiry after the enquiry has already been accepted", async () => {
    seedOrder("order-3", "PROCESSING");
    await expect(
      updateSupplierOrderStatus("order-3", "CANCELLED" as any, "supplier-1")
    ).rejects.toThrow(/Invalid order status transition/);
  });

  it("rejects Mark Dispatched before the enquiry has been accepted", async () => {
    seedOrder("order-4", "PLACED");
    await expect(updateSupplierOrderStatus("order-4", "DISPATCHED" as any)).rejects.toThrow(
      /Invalid order status transition/
    );
  });

  it("allows Mark Dispatched once accepted (PROCESSING -> DISPATCHED)", async () => {
    seedOrder("order-5", "PROCESSING");
    const result = await updateSupplierOrderStatus("order-5", "DISPATCHED" as any);
    expect(result.status).toBe("DISPATCHED");
  });

  it("rejects Mark Delivered before dispatch", async () => {
    seedOrder("order-6", "PROCESSING");
    await expect(updateSupplierOrderStatus("order-6", "DELIVERED" as any)).rejects.toThrow(
      /Invalid order status transition/
    );
  });

  it("allows Mark Delivered once dispatched (DISPATCHED -> DELIVERED)", async () => {
    seedOrder("order-7", "DISPATCHED");
    const result = await updateSupplierOrderStatus("order-7", "DELIVERED" as any);
    expect(result.status).toBe("DELIVERED");
  });

  it("rejects any transition attempted after the order has already been delivered", async () => {
    seedOrder("order-8", "DELIVERED");
    await expect(updateSupplierOrderStatus("order-8", "PROCESSING" as any)).rejects.toThrow(
      /Invalid order status transition/
    );
    await expect(updateSupplierOrderStatus("order-8", "CANCELLED" as any)).rejects.toThrow(
      /Invalid order status transition/
    );
  });

  it("throws a not-found error for an order that doesn't exist", async () => {
    await expect(updateSupplierOrderStatus("missing-order", "PROCESSING" as any)).rejects.toThrow(
      /Order not found/
    );
  });
});

// Task Test 1/2/3/4 — customer_order_status routing via the shared
// Notification Engine pipeline (packages/db), never via Twilio.
describe("updateSupplierOrderStatus — customer_order_status notification routing", () => {
  it("Test 1: ACCEPTED (PROCESSING) -> DISPATCHED calls notifyCustomerOrderStatusChanged with the real previous/new status, and never touches Twilio", async () => {
    const { sendWhatsAppMessage } = await import("./twilio-whatsapp");
    seedOrder("order-10", "PROCESSING");

    await updateSupplierOrderStatus("order-10", "DISPATCHED" as any);

    expect(notifyCustomerOrderStatusChanged).toHaveBeenCalledTimes(1);
    expect(notifyCustomerOrderStatusChanged).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: "order-10", previousStatus: "PROCESSING", newStatus: "DISPATCHED" })
    );
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("Test 2: a rejected same-status transition never reaches the notification call", async () => {
    seedOrder("order-11", "DISPATCHED");

    await expect(updateSupplierOrderStatus("order-11", "DISPATCHED" as any)).rejects.toThrow(
      /Invalid order status transition/
    );

    expect(notifyCustomerOrderStatusChanged).not.toHaveBeenCalled();
  });

  it("Test 3: three distinct transitions each invoke the notification call exactly once with the correct pair", async () => {
    seedOrder("order-12", "PLACED");

    await updateSupplierOrderStatus("order-12", "PROCESSING" as any);
    await updateSupplierOrderStatus("order-12", "DISPATCHED" as any);
    await updateSupplierOrderStatus("order-12", "DELIVERED" as any);

    expect(notifyCustomerOrderStatusChanged).toHaveBeenCalledTimes(3);
    const pairs = notifyCustomerOrderStatusChanged.mock.calls.map((call: any) => [call[1].previousStatus, call[1].newStatus]);
    expect(pairs).toEqual([
      ["PLACED", "PROCESSING"],
      ["PROCESSING", "DISPATCHED"],
      ["DISPATCHED", "DELIVERED"],
    ]);
  });

  it("Test 4: retrying an already-applied transition is rejected by the transition guard before notifying again", async () => {
    seedOrder("order-13", "PLACED");

    await updateSupplierOrderStatus("order-13", "PROCESSING" as any);
    expect(notifyCustomerOrderStatusChanged).toHaveBeenCalledTimes(1);

    // Retrying PLACED -> PROCESSING on an order already in PROCESSING is an
    // invalid transition per the state machine — rejected before any
    // further notification call is made (true duplicate-send prevention
    // lives inside notifyCustomerOrderStatusChanged's own dedupe-key check,
    // exercised directly in packages/db/lib/customer-order-status-notification.spec.ts).
    await expect(updateSupplierOrderStatus("order-13", "PROCESSING" as any)).rejects.toThrow(
      /Invalid order status transition/
    );
    expect(notifyCustomerOrderStatusChanged).toHaveBeenCalledTimes(1);
  });
});

// Vercel lifecycle fix — notifyCustomerOrderStatusChanged must be scheduled
// via waitUntil() rather than a detached `void` promise, so the Vercel
// serverless runtime keeps the function instance alive until the Meta
// Graph API call settles, instead of potentially killing it the moment the
// HTTP response for this request has been returned.
describe("updateSupplierOrderStatus — Vercel-safe notification scheduling (waitUntil)", () => {
  it("schedules the customer_order_status notification via waitUntil() instead of firing it detached", async () => {
    seedOrder("order-20", "PROCESSING");

    const result = await updateSupplierOrderStatus("order-20", "DISPATCHED" as any);

    // The order update itself must succeed and return immediately —
    // independent of whether/when the notification promise settles.
    expect(result.status).toBe("DISPATCHED");

    // Two notifications are now scheduled per transition:
    // customer_order_status (always) and payment_required (guarded inside
    // the shared payment-required-notification.ts module itself — a safe
    // no-op here since this transition is PROCESSING -> DISPATCHED, not
    // PLACED -> PROCESSING).
    expect(waitUntilMock).toHaveBeenCalledTimes(2);
    // The exact value handed to waitUntil() must be a Promise (the
    // notification work), proving it is being kept alive rather than
    // simply discarded.
    const scheduled = waitUntilMock.mock.calls[0][0];
    expect(scheduled).toBeInstanceOf(Promise);
    await Promise.all(waitUntilMock.mock.calls.map((call) => call[0]));

    expect(notifyCustomerOrderStatusChanged).toHaveBeenCalledTimes(1);
    expect(notifyCustomerOrderStatusChanged).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: "order-20", previousStatus: "PROCESSING", newStatus: "DISPATCHED" })
    );
  });

  it("the order update and HTTP-facing response succeed even when the notification promise rejects", async () => {
    seedOrder("order-21", "PROCESSING");
    notifyCustomerOrderStatusChanged.mockImplementationOnce(() => Promise.reject(new Error("Meta API down")));

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await updateSupplierOrderStatus("order-21", "DISPATCHED" as any);

    expect(result.status).toBe("DISPATCHED");
    expect(updateCalls.some((call) => call.where.id === "order-21")).toBe(true);

    // The rejection must be caught before being handed to waitUntil(), so
    // no unhandled promise rejection escapes this call, and the error is
    // still logged for observability.
    const scheduled = waitUntilMock.mock.calls[0][0];
    await expect(scheduled).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("does not notify (and does not schedule anything) for a same-status update, since the transition guard rejects it first", async () => {
    seedOrder("order-22", "DISPATCHED");

    await expect(updateSupplierOrderStatus("order-22", "DISPATCHED" as any)).rejects.toThrow(
      /Invalid order status transition/
    );

    expect(waitUntilMock).not.toHaveBeenCalled();
    expect(notifyCustomerOrderStatusChanged).not.toHaveBeenCalled();
  });

  it("schedules one waitUntil-wrapped notification per genuine transition across a full PLACED -> PROCESSING -> DISPATCHED -> DELIVERED sequence", async () => {
    seedOrder("order-23", "PLACED");

    await updateSupplierOrderStatus("order-23", "PROCESSING" as any);
    await updateSupplierOrderStatus("order-23", "DISPATCHED" as any);
    await updateSupplierOrderStatus("order-23", "DELIVERED" as any);

    // Two notifications (customer_order_status + payment_required) per
    // transition, three transitions = 6 scheduled calls.
    expect(waitUntilMock).toHaveBeenCalledTimes(6);
    await Promise.all(waitUntilMock.mock.calls.map((call) => call[0]));

    expect(notifyCustomerOrderStatusChanged).toHaveBeenCalledTimes(3);
    const pairs = notifyCustomerOrderStatusChanged.mock.calls.map((call: any) => [call[1].previousStatus, call[1].newStatus]);
    expect(pairs).toEqual([
      ["PLACED", "PROCESSING"],
      ["PROCESSING", "DISPATCHED"],
      ["DISPATCHED", "DELIVERED"],
    ]);

    // payment_required is scheduled on every transition (its own internal
    // guard decides whether to actually notify), but only the first
    // PLACED -> PROCESSING call here is the genuine trigger.
    expect(notifyPaymentRequired).toHaveBeenCalledTimes(3);
    expect(notifyPaymentRequired).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ orderId: "order-23", previousStatus: "PLACED", newStatus: "PROCESSING" })
    );
  });
});
