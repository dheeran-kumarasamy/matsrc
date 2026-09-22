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
      })),
    },
    orderItem: { findFirst: vi.fn(async () => ({ orderId: "order-1", supplierId: "sup-1" })) },
    orderTracking: { create: vi.fn(async () => ({})) },
  };

  const supplierContext = {
    getOrCreateSupplier: vi.fn(async () => ({ supplierProfile: { id: "sup-1" } })),
  };

  const notificationService = { notifyBuilderOrderDecision: vi.fn(async () => ({})) };
  const whatsAppAlertService = { sendOrderStatusUpdate: vi.fn(async () => ({})) };
  const whatsAppLifecycleService = { notifyBuilderOrderStatusTransition: vi.fn(async () => ({})) };

  const service = new OrdersService(
    prisma,
    supplierContext as any,
    notificationService as any,
    whatsAppAlertService as any,
    whatsAppLifecycleService as any
  );

  // findOne() drives the "current status" check inside updateStatus — stub
  // it directly so this test focuses purely on the transition guard rather
  // than the full order-item-lookup query shape.
  vi.spyOn(service, "findOne").mockResolvedValue({ status: orderRow.status } as any);

  return { service, prisma };
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
