import { describe, expect, it, vi, beforeEach } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { OrderStatus } from "@matsrc/db";
import { OrdersService } from "./orders.service";

// Backend transition guard test for OrdersService.updateStatus — verifies
// invalid supplier-triggered status transitions are rejected with a
// BadRequestException even if the request bypasses whatever UI gating
// exists (e.g. a direct PATCH to /supplier/orders/:id/status, or a WhatsApp
// flow calling this service directly). Mirrors the equivalent guard/tests
// for apps/supplier/lib/supplier-data.ts's updateSupplierOrderStatus.
function buildService(orderRow: { status: OrderStatus; items?: any[] }) {
  const prisma: any = {
    order: {
      update: vi.fn(async ({ data }: any) => ({
        id: "order-1",
        userId: "user-1",
        status: data.status ?? orderRow.status,
        items: [{ supplier: { companyName: "Acme" } }],
      })),
      findUnique: vi.fn(async () => ({
        items: [{ candidates: [] }],
        orderNumber: null,
      })),
    },
    orderItem: { findFirst: vi.fn(async () => ({ orderId: "order-1", supplierId: "sup-1" })) },
    orderTracking: { create: vi.fn(async () => ({})) },
    businessSequence: {
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async () => ({ value: 1 })),
    },
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

  const service = new OrdersService(
    prisma,
    supplierContext as any,
    notificationService as any,
    customerOrderStatusNotificationService as any
  );

  // findOne() drives the "current status" check inside updateStatus — stub
  // it directly so this test focuses purely on the transition guard rather
  // than the full order-item-lookup query shape.
  vi.spyOn(service, "findOne").mockResolvedValue({ status: orderRow.status } as any);

  return { service, prisma, customerOrderStatusNotificationService };
}

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
    vi.spyOn(service, "findOne").mockResolvedValueOnce({ status: OrderStatus.PROCESSING } as any);
    await service.updateStatus("order-1", OrderStatus.DISPATCHED, { userId: "u1" });
    vi.spyOn(service, "findOne").mockResolvedValueOnce({ status: OrderStatus.DISPATCHED } as any);
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
