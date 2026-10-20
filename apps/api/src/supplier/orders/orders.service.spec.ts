import { describe, expect, it, vi, beforeEach } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { OrderStatus, PaymentStatus } from "@matsrc/db";
import { OrdersService } from "./orders.service";

// Mock of Vercel's waitUntil() — records every promise handed to it so
// tests can assert the customer_order_status notification work is
// *scheduled* (kept alive past the HTTP response, per apps/api's
// serverless deployment — see apps/api/api/index.ts / vercel.json) rather
// than fired off as a detached `void` promise that the Vercel runtime may
// kill before it settles.
const { waitUntilMock } = vi.hoisted(() => ({ waitUntilMock: vi.fn() }));
vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}));

// Backend transition guard test for OrdersService.updateStatus — verifies
// invalid supplier-triggered status transitions are rejected with a
// BadRequestException even if the request bypasses whatever UI gating
// exists (e.g. a direct PATCH to /supplier/orders/:id/status, or a WhatsApp
// flow calling this service directly). Mirrors the equivalent guard/tests
// for apps/supplier/lib/supplier-data.ts's updateSupplierOrderStatus.
function buildService(orderRow: {
  status: OrderStatus;
  items?: any[];
  paymentStatus?: PaymentStatus;
  // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
  // Dispatch — overrides the SupplierInvoice snapshot checkOrderDispatchEligibility
  // reads. Defaults to a CONFIRMED invoice with the full totalAmount
  // already settled, so every PRE-EXISTING "allows Mark Dispatched"-style
  // test in this file (which predates this feature and never cares about
  // the new gate) keeps passing unchanged. Pass `null` or a different
  // status to exercise the new gate itself (see the dedicated describe
  // block below).
  supplierInvoice?: { status: "PENDING_REVIEW" | "REJECTED" | "CONFIRMED"; confirmedTotalAmount: number | null } | null;
  settledAmount?: number;
}) {
  const currentOrder = {
    id: "order-1",
    userId: "user-1",
    status: orderRow.status,
    orderNumber: null,
    totalAmount: 11000,
    taxAmount: null,
    finalPayableAmount: null,
    advancePercent: null,
    requiredAdvanceAmount: null,
    items:
      orderRow.items ?? [
        {
          id: "line-1",
          productId: "prod-1",
          quantity: 10,
          unitPrice: 1100,
          supplierUnitPrice: 1000,
          markupPercent: 10,
          product: { categoryId: "cat-1" },
        },
      ],
  };

  // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
  // Dispatch — see buildService's own param doc comment above.
  const dispatchSupplierInvoice =
    orderRow.supplierInvoice !== undefined
      ? orderRow.supplierInvoice
      : { status: "CONFIRMED" as const, confirmedTotalAmount: currentOrder.totalAmount };
  const dispatchSettledAmount = orderRow.settledAmount ?? currentOrder.totalAmount;

  // Tracks the most recently written status/snapshot-fields across
  // update/updateMany calls so findUniqueOrThrow's post-write re-read
  // reflects whatever this test actually requested/computed, instead of
  // hardcoding a single transition or ignoring the GST snapshot fields.
  let writtenStatus: OrderStatus = orderRow.status;
  const writtenSnapshotFields: Record<string, unknown> = {};

  const prisma: any = {
    order: {
      update: vi.fn(async ({ data }: any) => {
        if (data.status) writtenStatus = data.status;
        return { ...currentOrder, status: data.status ?? orderRow.status, items: [{ supplier: { companyName: "Acme" } }] };
      }),
      updateMany: vi.fn(async ({ data }: any) => {
        if (data.status) writtenStatus = data.status;
        for (const key of ["taxAmount", "finalPayableAmount", "advancePercent", "requiredAdvanceAmount"]) {
          if (key in data) writtenSnapshotFields[key] = data[key];
        }
        return { count: 1 };
      }),
      // Real OrdersService.updateStatus calls order.findUnique with
      // different `select`/`include` shapes for different purposes
      // (orderNumber-only lookup inside the transaction; the GST-snapshot
      // items+product lookup; the plain existing-snapshot-consistency
      // lookup; the post-loss-race re-read) — branch on the shape so each
      // caller gets back data consistent with its own query.
      findUnique: vi.fn(async (args: any) => {
        if (args?.select?.orderNumber !== undefined && Object.keys(args.select).length === 1) {
          return { orderNumber: currentOrder.orderNumber };
        }
        // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
        // Dispatch — checkOrderDispatchEligibility's own query shape
        // (packages/db/lib/order-dispatch-eligibility.ts), distinguished by
        // its unique `select.supplierInvoice` field.
        if (args?.select?.supplierInvoice !== undefined) {
          return {
            id: currentOrder.id,
            paymentStatus: orderRow.paymentStatus ?? PaymentStatus.PAID,
            totalAmount: currentOrder.totalAmount,
            finalPayableAmount: currentOrder.finalPayableAmount,
            supplierInvoice: dispatchSupplierInvoice,
          };
        }
        if (args?.include?.items?.include?.product) {
          return currentOrder;
        }
        if (args?.select?.taxAmount !== undefined || args?.select?.items) {
          return {
            totalAmount: currentOrder.totalAmount,
            taxAmount: currentOrder.taxAmount,
            finalPayableAmount: currentOrder.finalPayableAmount,
            advancePercent: currentOrder.advancePercent,
            requiredAdvanceAmount: currentOrder.requiredAdvanceAmount,
            items: currentOrder.taxAmount !== null
              ? currentOrder.items.map((item: any) => ({ id: item.id, taxRatePercent: 18, taxAmount: 0 }))
              : currentOrder.items.map((item: any) => ({ id: item.id, taxRatePercent: null, taxAmount: null })),
          };
        }
        return {
          ...currentOrder,
          items: currentOrder.items.map((item: any) => ({
            id: item.id,
            taxRatePercent: currentOrder.taxAmount !== null ? 18 : null,
            taxAmount: currentOrder.taxAmount !== null ? 0 : null,
          })),
        };
      }),
      findUniqueOrThrow: vi.fn(async () => ({
        ...currentOrder,
        ...writtenSnapshotFields,
        status: writtenStatus,
        items: [{ supplier: { companyName: "Acme" } }],
      })),
    },
    // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
    // Dispatch — checkOrderDispatchEligibility's settled-amount query
    // (packages/db/lib/order-dispatch-eligibility.ts's
    // calculateOrderSettledAmount). A single ORDER_PAYMENT ledger entry of
    // `dispatchSettledAmount` is the simplest fixture that produces the
    // desired settled total.
    customerAdvanceTransaction: {
      findMany: vi.fn(async () => (dispatchSettledAmount > 0 ? [{ type: "ORDER_PAYMENT", amount: dispatchSettledAmount }] : [])),
    },
    paymentVerification: {
      findUnique: vi.fn(async () => null),
    },
    orderItem: {
      findFirst: vi.fn(async () => ({ orderId: "order-1", supplierId: "sup-1" })),
      update: vi.fn(async () => ({})),
    },
    orderTracking: { create: vi.fn(async () => ({})) },
    businessSequence: {
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async () => ({ value: 1 })),
    },
    taxSetting: {
      findMany: vi.fn(async () => [{ scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true }]),
    },
    advanceConfig: { findUnique: vi.fn(async () => null) },
    $queryRaw: vi.fn(async () => ({})),
    // Minimal $transaction stub: just invokes the callback with the same
    // fake prisma object as `tx` (no real transaction semantics needed for
    // these unit tests), matching the new orderNumber-generation flow in
    // OrdersService.updateStatus.
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };

  const supplierContext = {
    getOrCreateSupplier: vi.fn(async () => ({ supplierProfile: { id: "sup-1" } })),
  };

  const notificationService = { notifyBuilderOrderDecision: vi.fn(async () => ({})) };
  const customerOrderStatusNotificationService = { notifyIfTransitioned: vi.fn(async () => ({})) };
  const supplierRfqReceivedNotificationService = { notify: vi.fn(async () => ({})) };
  const paymentRequiredNotificationService = { notifyIfTransitioned: vi.fn(async () => ({})) };

  const service = new OrdersService(
    prisma,
    supplierContext as any,
    notificationService as any,
    customerOrderStatusNotificationService as any,
    supplierRfqReceivedNotificationService as any,
    paymentRequiredNotificationService as any
  );

  // findOne() drives the "current status" (and, for C34, "current
  // paymentStatus") check inside updateStatus — stub it directly so this
  // test focuses purely on the transition/payment guards rather than the
  // full order-item-lookup query shape. Defaults to PAID so every
  // pre-existing transition-guard test above (none of which cares about
  // payment) keeps passing unchanged.
  vi.spyOn(service, "findOne").mockResolvedValue({
    status: orderRow.status,
    paymentStatus: orderRow.paymentStatus ?? PaymentStatus.PAID,
  } as any);

  return { service, prisma, customerOrderStatusNotificationService, paymentRequiredNotificationService, currentOrder };
}

beforeEach(() => {
  waitUntilMock.mockClear();
});

describe("OrdersService.updateStatus — backend transition guard", () => {
  it("allows Confirm Enquiry (PLACED -> PROCESSING)", async () => {
    const { service } = buildService({ status: OrderStatus.PLACED });
    const result = await service.updateStatus("order-1", OrderStatus.PROCESSING, { userId: "u1" });
    expect(result.status).toBe(OrderStatus.PROCESSING);
  });

  it("rejects Confirm Enquiry once already accepted", async () => {
    const { service } = buildService({ status: OrderStatus.PROCESSING });
    await expect(
      service.updateStatus("order-1", OrderStatus.PROCESSING, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects Decline Enquiry once already accepted", async () => {
    const { service } = buildService({ status: OrderStatus.PROCESSING });
    await expect(
      service.updateStatus("order-1", OrderStatus.CANCELLED, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects Mark Dispatched before acceptance", async () => {
    const { service } = buildService({ status: OrderStatus.PLACED });
    await expect(
      service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows Mark Dispatched once accepted", async () => {
    const { service } = buildService({ status: OrderStatus.PROCESSING });
    const result = await service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" });
    expect(result.status).toBe(OrderStatus.DISPATCHED);
  });

  it("rejects Mark Delivered before dispatch", async () => {
    const { service } = buildService({ status: OrderStatus.PROCESSING });
    await expect(
      service.updateStatus("order-1", OrderStatus.DELIVERED, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows Mark Delivered once dispatched", async () => {
    const { service } = buildService({ status: OrderStatus.DISPATCHED });
    const result = await service.updateStatus("order-1", OrderStatus.DELIVERED, { userId: "u1" });
    expect(result.status).toBe(OrderStatus.DELIVERED);
  });

  it("rejects any transition once already delivered (terminal state)", async () => {
    const { service } = buildService({ status: OrderStatus.DELIVERED });
    await expect(
      service.updateStatus("order-1", OrderStatus.PROCESSING, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateStatus("order-1", OrderStatus.CANCELLED, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// C34 — an order must never be marked DELIVERED while payment is not
// settled, enforced server-side regardless of caller (supplier portal
// "Mark Delivered" action, WhatsApp delivery-confirmation flow, or a direct
// API call bypassing any UI entirely — all funnel through this one
// updateStatus() method).
describe("OrdersService.updateStatus — C34 payment-before-delivery guard", () => {
  it("rejects Mark Delivered when payment is still PENDING", async () => {
    const { service } = buildService({ status: OrderStatus.DISPATCHED, paymentStatus: PaymentStatus.PENDING });

    await expect(
      service.updateStatus("order-1", OrderStatus.DELIVERED, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects Mark Delivered when payment proof is still PENDING_VERIFICATION", async () => {
    const { service } = buildService({
      status: OrderStatus.DISPATCHED,
      paymentStatus: PaymentStatus.PENDING_VERIFICATION,
    });

    await expect(
      service.updateStatus("order-1", OrderStatus.DELIVERED, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects Mark Delivered for a REFUNDED order", async () => {
    const { service } = buildService({ status: OrderStatus.DISPATCHED, paymentStatus: PaymentStatus.REFUNDED });

    await expect(
      service.updateStatus("order-1", OrderStatus.DELIVERED, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows Mark Delivered once payment is PAID", async () => {
    const { service } = buildService({ status: OrderStatus.DISPATCHED, paymentStatus: PaymentStatus.PAID });

    const result = await service.updateStatus("order-1", OrderStatus.DELIVERED, { userId: "u1" });

    expect(result.status).toBe(OrderStatus.DELIVERED);
  });

  it("allows Mark Delivered from OUT_FOR_DELIVERY once payment is PAID", async () => {
    const { service } = buildService({ status: OrderStatus.OUT_FOR_DELIVERY, paymentStatus: PaymentStatus.PAID });

    const result = await service.updateStatus("order-1", OrderStatus.DELIVERED, { userId: "u1" });

    expect(result.status).toBe(OrderStatus.DELIVERED);
  });

  it("never blocks non-delivery transitions regardless of payment status", async () => {
    const { service } = buildService({ status: OrderStatus.PROCESSING, paymentStatus: PaymentStatus.PENDING });

    const result = await service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" });

    expect(result.status).toBe(OrderStatus.DISPATCHED);
  });

  it("does not schedule any notification when Mark Delivered is rejected for unpaid orders", async () => {
    const { service, customerOrderStatusNotificationService } = buildService({
      status: OrderStatus.DISPATCHED,
      paymentStatus: PaymentStatus.PENDING,
    });

    await expect(
      service.updateStatus("order-1", OrderStatus.DELIVERED, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(waitUntilMock).not.toHaveBeenCalled();
    expect(customerOrderStatusNotificationService.notifyIfTransitioned).not.toHaveBeenCalled();
  });
});

// Task Test 1/2/3 — customer_order_status routing via the Notification
// Engine, with the previous Twilio/WhatsAppLifecycle duplicate sends
// removed from this call site entirely (no mocks for them exist above —
// OrdersService's constructor no longer accepts those dependencies at all).
describe("OrdersService.updateStatus — customer_order_status notification routing", () => {
  it("Test 1: ACCEPTED (PROCESSING) -> DISPATCHED notifies exactly once with the real previous/new status", async () => {
    const { service, customerOrderStatusNotificationService } = buildService({ status: OrderStatus.PROCESSING });

    const result = await service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" });

    expect(result.status).toBe(OrderStatus.DISPATCHED);
    expect(customerOrderStatusNotificationService.notifyIfTransitioned).toHaveBeenCalledTimes(1);
    expect(customerOrderStatusNotificationService.notifyIfTransitioned).toHaveBeenCalledWith({
      orderId: "order-1",
      previousStatus: OrderStatus.PROCESSING,
      newStatus: OrderStatus.DISPATCHED,
    });
  });

  it("Test 2: a rejected (invalid) transition never reaches the notification call", async () => {
    const { service, customerOrderStatusNotificationService } = buildService({ status: OrderStatus.PLACED });

    await expect(
      service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(customerOrderStatusNotificationService.notifyIfTransitioned).not.toHaveBeenCalled();
  });

  it("Test 3: three distinct transitions each notify exactly once with the correct pair", async () => {
    const { service, customerOrderStatusNotificationService } = buildService({ status: OrderStatus.PLACED });

    await service.updateStatus("order-1", OrderStatus.PROCESSING, { userId: "u1" });
    // findOne() is stubbed to a fixed value above, so re-stub between calls
    // to reflect the just-applied status for the next transition in this
    // sequence (mirrors the real findOne() re-reading the committed row).
    // paymentStatus: PAID so the C34 payment-before-delivery guard (which
    // this test isn't exercising) doesn't block the final DELIVERED step.
    vi.spyOn(service, "findOne").mockResolvedValueOnce({ status: OrderStatus.PROCESSING, paymentStatus: PaymentStatus.PAID } as any);
    await service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" });
    vi.spyOn(service, "findOne").mockResolvedValueOnce({ status: OrderStatus.DISPATCHED, paymentStatus: PaymentStatus.PAID } as any);
    await service.updateStatus("order-1", OrderStatus.DELIVERED, { userId: "u1" });

    expect(customerOrderStatusNotificationService.notifyIfTransitioned).toHaveBeenCalledTimes(3);
    const pairs = customerOrderStatusNotificationService.notifyIfTransitioned.mock.calls.map(
      (call: any) => [call[0].previousStatus, call[0].newStatus]
    );
    expect(pairs).toEqual([
      [OrderStatus.PLACED, OrderStatus.PROCESSING],
      [OrderStatus.PROCESSING, OrderStatus.DISPATCHED],
      [OrderStatus.DISPATCHED, OrderStatus.DELIVERED],
    ]);
  });
});

// Vercel lifecycle fix — notifyIfTransitioned must be scheduled via
// waitUntil() rather than a detached `void` promise, since apps/api also
// runs as a Vercel serverless function (apps/api/api/index.ts).
describe("OrdersService.updateStatus — Vercel-safe notification scheduling (waitUntil)", () => {
  it("schedules the customer_order_status notification via waitUntil() instead of firing it detached", async () => {
    const { service, customerOrderStatusNotificationService } = buildService({ status: OrderStatus.PROCESSING });

    const result = await service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" });

    // The order update returns immediately, independent of whether/when
    // the notification promise settles.
    expect(result.status).toBe(OrderStatus.DISPATCHED);

    // Two notifications are scheduled per transition now:
    // customer_order_status (always) and payment_required (guarded inside
    // the service itself — see PaymentRequiredNotificationService, a safe
    // no-op here since this transition is PROCESSING -> DISPATCHED, not
    // PLACED -> PROCESSING).
    expect(waitUntilMock).toHaveBeenCalledTimes(2);
    const scheduled = waitUntilMock.mock.calls[0][0];
    expect(scheduled).toBeInstanceOf(Promise);
    await scheduled;
    await waitUntilMock.mock.calls[1][0];

    expect(customerOrderStatusNotificationService.notifyIfTransitioned).toHaveBeenCalledTimes(1);
  });

  it("the status update succeeds even when the notification promise rejects, and the rejection never escapes unhandled", async () => {
    const { service, customerOrderStatusNotificationService } = buildService({ status: OrderStatus.PROCESSING });
    customerOrderStatusNotificationService.notifyIfTransitioned.mockRejectedValueOnce(new Error("Meta API down"));

    const result = await service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" });

    expect(result.status).toBe(OrderStatus.DISPATCHED);

    const scheduled = waitUntilMock.mock.calls[0][0];
    await expect(scheduled).resolves.toBeUndefined();
  });

  it("does not schedule anything for a rejected (same-status/invalid) transition", async () => {
    const { customerOrderStatusNotificationService, service } = buildService({ status: OrderStatus.PLACED });

    await expect(
      service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(waitUntilMock).not.toHaveBeenCalled();
    expect(customerOrderStatusNotificationService.notifyIfTransitioned).not.toHaveBeenCalled();
  });
});

// payment_required WhatsApp notification (PAYMENT_REQUIRED event) — fired
// via the same waitUntil()-scheduled pattern as customer_order_status, but
// only for the supplier "Confirm Enquiry" (PLACED -> PROCESSING) action.
describe("OrdersService.updateStatus — payment_required notification routing", () => {
  it("schedules payment_required for PLACED -> PROCESSING (Confirm Enquiry)", async () => {
    const { service, paymentRequiredNotificationService } = buildService({ status: OrderStatus.PLACED });

    await service.updateStatus("order-1", OrderStatus.PROCESSING, { userId: "u1" });

    expect(waitUntilMock).toHaveBeenCalledTimes(2);
    await Promise.all(waitUntilMock.mock.calls.map((call: any) => call[0]));

    expect(paymentRequiredNotificationService.notifyIfTransitioned).toHaveBeenCalledTimes(1);
    expect(paymentRequiredNotificationService.notifyIfTransitioned).toHaveBeenCalledWith({
      orderId: "order-1",
      previousStatus: OrderStatus.PLACED,
      newStatus: OrderStatus.PROCESSING,
    });
  });

  it("still invokes the (internally-guarded) payment_required service for unrelated transitions, but never for a rejected transition", async () => {
    const { service, paymentRequiredNotificationService } = buildService({ status: OrderStatus.PROCESSING });

    await service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" });
    await Promise.all(waitUntilMock.mock.calls.map((call: any) => call[0]));

    // The call site always schedules it (the PLACED/PENDING guard lives
    // inside PaymentRequiredNotificationService itself, exercised directly
    // in payment-required-notification.service.spec.ts) — but a rejected
    // transition must never schedule anything at all.
    expect(paymentRequiredNotificationService.notifyIfTransitioned).toHaveBeenCalledTimes(1);

    waitUntilMock.mockClear();
    paymentRequiredNotificationService.notifyIfTransitioned.mockClear();

    const { service: rejectedService, paymentRequiredNotificationService: rejectedDep } = buildService({
      status: OrderStatus.PLACED,
    });
    await expect(
      rejectedService.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(waitUntilMock).not.toHaveBeenCalled();
    expect(rejectedDep.notifyIfTransitioned).not.toHaveBeenCalled();
  });
});

// Product-Level GST / GST-Inclusive Buyer Payable (Phase 3B) — the
// confirmation snapshot freeze through OrdersService.updateStatus (the
// NestJS twin of apps/supplier's updateSupplierOrderStatus and
// BestPriceSelectionService.selectAndFinalizeIfEligible).
describe("OrdersService.updateStatus — GST snapshot freeze", () => {
  it("freezes taxAmount/finalPayableAmount on Order and taxRatePercent/taxAmount on OrderItem for a genuine PLACED -> PROCESSING confirmation", async () => {
    const { service, prisma } = buildService({ status: OrderStatus.PLACED });
    await service.updateStatus("order-1", OrderStatus.PROCESSING, { userId: "u1" });

    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order-1", status: OrderStatus.PLACED },
      data: expect.objectContaining({
        status: OrderStatus.PROCESSING,
        taxAmount: 1980,
        finalPayableAmount: 12980,
        advancePercent: null,
        requiredAdvanceAmount: null,
      }),
    });
    expect(prisma.orderItem.update).toHaveBeenCalledWith({
      where: { id: "line-1" },
      data: { taxRatePercent: 18, taxAmount: 1980 },
    });
  });

  it("calculates the informational required advance from the GST-inclusive payable when AdvanceConfig is enabled", async () => {
    const { service, prisma } = buildService({ status: OrderStatus.PLACED });
    prisma.advanceConfig.findUnique.mockResolvedValue({ percentage: 20, isEnabled: true });

    await service.updateStatus("order-1", OrderStatus.PROCESSING, { userId: "u1" });

    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order-1", status: OrderStatus.PLACED },
      data: expect.objectContaining({ advancePercent: 20, requiredAdvanceAmount: 2596 }),
    });
  });

  it("blocks confirmation with no partial writes when no GST configuration exists", async () => {
    const { service, prisma } = buildService({ status: OrderStatus.PLACED });
    prisma.taxSetting.findMany.mockResolvedValue([]);

    await expect(service.updateStatus("order-1", OrderStatus.PROCESSING, { userId: "u1" })).rejects.toBeInstanceOf(
      BadRequestException
    );

    expect(prisma.orderItem.update).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it("applies markup exactly once (buyer price derived from the already-resolved markupPercent, never re-resolved)", async () => {
    const { service, prisma } = buildService({
      status: OrderStatus.PLACED,
      items: [
        {
          id: "line-1",
          productId: "prod-1",
          quantity: 1,
          unitPrice: 220,
          supplierUnitPrice: 200,
          markupPercent: 10,
          product: { categoryId: "cat-1" },
        },
      ],
    });

    await service.updateStatus("order-1", OrderStatus.PROCESSING, { userId: "u1" });

    // buyerUnitPrice = 200 * 1.1 = 220 (not 200*1.1*1.1=242 — proves markup
    // is derived once from the stored markupPercent, never compounded);
    // tax = 220 * 0.18 = 39.6.
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order-1", status: OrderStatus.PLACED },
      data: expect.objectContaining({ taxAmount: 39.6 }),
    });
  });
});

describe("OrdersService.updateStatus — retry and concurrency safety", () => {
  it("does not reapply markup or rewrite an existing complete snapshot for a non-confirmation transition", async () => {
    const { service, prisma } = buildService({ status: OrderStatus.PROCESSING });
    prisma.order.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.orderNumber !== undefined && Object.keys(args.select).length === 1) {
        return { orderNumber: "OD/2601/00001" };
      }
      // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
      // Dispatch — checkOrderDispatchEligibility's own query shape; this
      // test is about the SEPARATE GST-snapshot-reapplication concern, so
      // it satisfies the dispatch gate with a trivially-eligible fixture.
      if (args?.select?.supplierInvoice !== undefined) {
        return {
          id: "order-1",
          paymentStatus: PaymentStatus.PAID,
          totalAmount: 11000,
          finalPayableAmount: 12980,
          supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 11000 },
        };
      }
      if (args?.select?.taxAmount !== undefined) {
        return {
          totalAmount: 11000,
          taxAmount: 1980,
          finalPayableAmount: 12980,
          advancePercent: null,
          requiredAdvanceAmount: null,
          items: [{ id: "line-1", taxRatePercent: 18, taxAmount: 1980 }],
        };
      }
      return null;
    });

    await service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" });

    expect(prisma.orderItem.update).not.toHaveBeenCalled();
  });

  it("fails safely (throws) rather than silently repairing a partially-populated snapshot", async () => {
    const { service, prisma } = buildService({ status: OrderStatus.PROCESSING });
    prisma.order.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.orderNumber !== undefined && Object.keys(args.select).length === 1) {
        return { orderNumber: "OD/2601/00001" };
      }
      // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
      // Dispatch — satisfy the dispatch gate so this test can reach (and
      // actually exercise) the separate snapshot-integrity check below.
      if (args?.select?.supplierInvoice !== undefined) {
        return {
          id: "order-1",
          paymentStatus: PaymentStatus.PAID,
          totalAmount: 11000,
          finalPayableAmount: null,
          supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 11000 },
        };
      }
      if (args?.select?.taxAmount !== undefined) {
        return {
          totalAmount: 11000,
          taxAmount: 1980,
          finalPayableAmount: null,
          advancePercent: null,
          requiredAdvanceAmount: null,
          items: [],
        };
      }
      return null;
    });

    await expect(service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" })).rejects.toThrow(
      /inconsistent financial snapshot/
    );
  });

  it("loses a concurrent confirmation race safely: returns the winner's result without a second write", async () => {
    const { service, prisma } = buildService({ status: OrderStatus.PLACED });
    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    prisma.order.findUnique.mockImplementation(async (args: any) => {
      if (args?.include?.items?.include?.product) {
        return {
          id: "order-1",
          items: [
            {
              id: "line-1",
              productId: "prod-1",
              quantity: 10,
              unitPrice: 1100,
              supplierUnitPrice: 1000,
              markupPercent: 10,
              product: { categoryId: "cat-1" },
            },
          ],
        };
      }
      return {
        id: "order-1",
        status: OrderStatus.PROCESSING,
        totalAmount: 11000,
        taxAmount: 1980,
        finalPayableAmount: 12980,
        advancePercent: null,
        requiredAdvanceAmount: null,
        items: [{ id: "line-1", taxRatePercent: 18, taxAmount: 1980 }],
      };
    });

    const result: any = await service.updateStatus("order-1", OrderStatus.PROCESSING, { userId: "u1" });

    expect(result.status).toBe(OrderStatus.PROCESSING);
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
  });

  it("rolls back all snapshot writes when the transaction fails", async () => {
    const { service, prisma } = buildService({ status: OrderStatus.PLACED });
    prisma.$transaction = vi.fn(async () => {
      throw new Error("DB connection lost mid-transaction");
    });

    await expect(service.updateStatus("order-1", OrderStatus.PROCESSING, { userId: "u1" })).rejects.toThrow(
      /DB connection lost/
    );
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
  });
});

// Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
// Dispatch — server-side enforcement that PROCESSING -> DISPATCHED is
// blocked until checkOrderDispatchEligibility (the shared,
// packages/db-level gate) reports eligible. The gate's own full behaviour
// is unit-tested exhaustively in
// packages/db/lib/order-dispatch-eligibility.spec.ts — these tests only
// verify OrdersService.updateStatus correctly calls it and correctly
// propagates its verdict as a BadRequestException, mirroring
// apps/supplier/lib/order-status-update.spec.ts's identical coverage for
// the Next.js supplier-portal's own equivalent call site.
describe("OrdersService.updateStatus — Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated Dispatch", () => {
  it("rejects Mark Dispatched when checkOrderDispatchEligibility reports ineligible, as a BadRequestException with its exact reason", async () => {
    const { service, prisma } = buildService({ status: OrderStatus.PROCESSING, supplierInvoice: null });

    await expect(service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" })).rejects.toMatchObject({
      response: { message: expect.stringMatching(/has not yet uploaded an invoice/) },
    });
    // Belt-and-braces: still a genuine BadRequestException instance.
    await expect(service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prisma.order.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: OrderStatus.DISPATCHED } }));
  });

  it("rejects Mark Dispatched while the SupplierInvoice is still PENDING_REVIEW", async () => {
    const { service } = buildService({
      status: OrderStatus.PROCESSING,
      supplierInvoice: { status: "PENDING_REVIEW", confirmedTotalAmount: null },
    });

    await expect(service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" })).rejects.toMatchObject({
      response: { message: expect.stringMatching(/awaiting Admin review/) },
    });
  });

  it("rejects Mark Dispatched when the confirmed total is only partially settled", async () => {
    const { service } = buildService({
      status: OrderStatus.PROCESSING,
      supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 11000 },
      settledAmount: 5000,
    });

    await expect(service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" })).rejects.toMatchObject({
      response: { message: expect.stringMatching(/not been fully paid/) },
    });
  });

  it("allows Mark Dispatched once the SupplierInvoice is CONFIRMED and fully settled", async () => {
    const { service } = buildService({
      status: OrderStatus.PROCESSING,
      supplierInvoice: { status: "CONFIRMED", confirmedTotalAmount: 11000 },
      settledAmount: 11000,
    });

    const result = await service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" });
    expect(result.status).toBe(OrderStatus.DISPATCHED);
  });
});
