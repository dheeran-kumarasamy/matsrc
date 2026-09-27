import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PurchaseOrderStatus } from "@matsrc/db";
import { PurchaseOrdersService } from "./purchase-orders.service";

function buildService(prismaOverrides: Partial<any> = {}) {
  const prisma = {
    purchaseOrder: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    purchaseOrderLineItem: {
      update: vi.fn(),
    },
    ...prismaOverrides,
  };

  const builderContext = {
    getOrCreateBuilder: vi.fn().mockResolvedValue({ user: { id: "builder-1", name: "Builder One", email: "builder@example.com" } }),
  };

  const notificationService = {
    sendWhatsApp: vi.fn().mockResolvedValue(undefined),
  };

  const whatsAppLifecycleService = {
    notifyBuilderPoIssued: vi.fn().mockResolvedValue(undefined),
  };

  const service = new PurchaseOrdersService(
    prisma as any,
    builderContext as any,
    notificationService as any,
    whatsAppLifecycleService as any
  );

  return { service, prisma, builderContext };
}

const userCtx = { userId: "builder-1", email: "builder@example.com", name: "Builder One" };

describe("PurchaseOrdersService.create", () => {
  it("copies quantity from the confirmed OrderItem.quantity, never from an arbitrary/editable value", async () => {
    const { service, prisma } = buildService({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-1",
          quoteSelectionCompletedAt: new Date(),
          selectedSupplierId: "sup-1",
          paymentMethod: "UPI",
          bestPriceTotal: null,
          tentativeDeliveryDate: null,
          items: [
            { productId: "p1", quantity: 42, unitPrice: 100, deliveryDate: null },
          ],
        }),
      },
    });

    prisma.purchaseOrder.findFirst.mockResolvedValueOnce(null); // no existing PO
    prisma.purchaseOrder.create.mockResolvedValue({
      id: "po-1",
      lineItems: [{ id: "li-1", productId: "p1", quantity: 42, unitPrice: 100, tax: 0, product: { name: "Cement", unit: "bag" } }],
      supplier: { id: "sup-1", companyName: "Supplier One" },
      builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
    });

    const result = await service.create(userCtx, { orderId: "order-1" } as any);

    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lineItems: expect.objectContaining({
            create: [expect.objectContaining({ productId: "p1", quantity: 42 })],
          }),
        }),
      })
    );
    expect(result.lineItems[0].quantity).toBe(42);
  });
});

describe("PurchaseOrdersService.update", () => {
  it("does not persist a quantity change even if the caller attempts to pass one", async () => {
    const { service, prisma } = buildService();

    prisma.purchaseOrder.findFirst
      .mockResolvedValueOnce({
        id: "po-1",
        status: PurchaseOrderStatus.DRAFT,
        lineItems: [{ id: "li-1", quantity: 42 }],
      })
      .mockResolvedValueOnce({
        id: "po-1",
        status: PurchaseOrderStatus.DRAFT,
        supplier: { id: "sup-1", companyName: "Supplier One" },
        builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
        lineItems: [{ id: "li-1", quantity: 42, unitPrice: 100, tax: 0, product: { name: "Cement", unit: "bag" } }],
      });

    // Simulate a manually crafted request body that tries to smuggle a quantity
    // change in via the line item update payload (the DTO/whitelist would
    // normally strip this before it reaches the service, but the service
    // itself must not act on it either).
    await service.update(userCtx, "po-1", {
      lineItems: [{ id: "li-1", quantity: 999 } as any],
    } as any);

    expect(prisma.purchaseOrderLineItem.update).not.toHaveBeenCalled();
  });

  it("still allows the delivery date to be updated while in Draft state", async () => {
    const { service, prisma } = buildService();

    prisma.purchaseOrder.findFirst
      .mockResolvedValueOnce({
        id: "po-1",
        status: PurchaseOrderStatus.DRAFT,
        lineItems: [{ id: "li-1", quantity: 42 }],
      })
      .mockResolvedValueOnce({
        id: "po-1",
        status: PurchaseOrderStatus.DRAFT,
        supplier: { id: "sup-1", companyName: "Supplier One" },
        builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
        lineItems: [{ id: "li-1", quantity: 42, unitPrice: 100, tax: 0, product: { name: "Cement", unit: "bag" } }],
      });

    await service.update(userCtx, "po-1", {
      lineItems: [{ id: "li-1", deliveryDate: "2026-10-01" } as any],
    } as any);

    expect(prisma.purchaseOrderLineItem.update).toHaveBeenCalledWith({
      where: { id: "li-1" },
      data: { deliveryDate: new Date("2026-10-01") },
    });
  });

  it("rejects edits once the purchase order is no longer in Draft state", async () => {
    const { service, prisma } = buildService();
    prisma.purchaseOrder.findFirst.mockResolvedValueOnce({
      id: "po-1",
      status: PurchaseOrderStatus.ISSUED,
      lineItems: [{ id: "li-1", quantity: 42 }],
    });

    await expect(
      service.update(userCtx, "po-1", { lineItems: [{ id: "li-1", quantity: 999 } as any] } as any)
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.purchaseOrderLineItem.update).not.toHaveBeenCalled();
  });

  it("throws NotFoundException for a purchase order that does not belong to the builder", async () => {
    const { service, prisma } = buildService();
    prisma.purchaseOrder.findFirst.mockResolvedValueOnce(null);

    await expect(service.update(userCtx, "po-missing", {} as any)).rejects.toThrow(NotFoundException);
  });
});
