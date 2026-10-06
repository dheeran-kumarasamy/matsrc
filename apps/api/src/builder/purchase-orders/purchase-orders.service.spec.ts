import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseOrderStatus } from "@matsrc/db";
import { PurchaseOrdersService } from "./purchase-orders.service";

// Mock of Vercel's waitUntil() — records every promise handed to it so
// tests can assert the supplier_po_alert notification work is *scheduled*
// (kept alive past the HTTP response) rather than fired off as a detached
// `void` promise the Vercel runtime may kill before it settles. Mirrors the
// identical mock already used by orders.service.spec.ts.
const { waitUntilMock } = vi.hoisted(() => ({ waitUntilMock: vi.fn() }));
vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}));

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
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
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

  const supplierPoReceivedNotificationService = {
    notify: vi.fn().mockResolvedValue(undefined),
  };

  const service = new PurchaseOrdersService(
    prisma as any,
    builderContext as any,
    notificationService as any,
    whatsAppLifecycleService as any,
    supplierPoReceivedNotificationService as any
  );

  return { service, prisma, builderContext, supplierPoReceivedNotificationService };
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

  // Verify and Fix PO Generation to Use Accepted Supplier RFQ Price.
  //
  // Catalogue price = ₹400, Supplier RFQ quote = ₹425 (already reflected on
  // OrderItem.unitPrice by BestPriceSelectionService — see that service's
  // own regression test). PO must use ₹425, never ₹400.
  it("uses the accepted supplier RFQ quotation price (OrderItem.unitPrice), not the catalogue price, and computes GST from it", async () => {
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
            // unitPrice (425) is the ACCEPTED supplier quote — distinct
            // from any hypothetical catalogue price (400), which this
            // service must never read.
            { productId: "p1", quantity: 100, unitPrice: 425, taxRatePercent: 18, deliveryDate: null },
          ],
        }),
      },
    });

    prisma.purchaseOrder.findFirst.mockResolvedValueOnce(null);
    prisma.purchaseOrder.create.mockImplementation(async ({ data }: any) => ({
      id: "po-1",
      lineItems: data.lineItems.create.map((li: any, i: number) => ({
        id: `li-${i + 1}`,
        ...li,
        product: { name: "Cement", unit: "bag" },
      })),
      supplier: { id: "sup-1", companyName: "Supplier One" },
      builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
    }));

    const result = await service.create(userCtx, { orderId: "order-1" } as any);

    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lineItems: expect.objectContaining({
            create: [expect.objectContaining({ productId: "p1", quantity: 100, unitPrice: 425, tax: 7650 })],
          }),
        }),
      })
    );

    expect(result.lineItems[0].unitPrice).toBe(425);
    expect(result.lineItems[0].tax).toBe(7650);
    // lineTotal = unitPrice * quantity + tax = 42500 + 7650 = 50150
    expect(result.lineItems[0].lineTotal).toBe(50150);
  });

  // Multi-line verification: each PO line must use ITS OWN accepted
  // supplier quotation price, never one price applied to every line.
  it("uses each line item's own accepted supplier quote price independently", async () => {
    const { service, prisma } = buildService({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-2",
          quoteSelectionCompletedAt: new Date(),
          selectedSupplierId: "sup-1",
          paymentMethod: "UPI",
          bestPriceTotal: null,
          tentativeDeliveryDate: null,
          items: [
            { productId: "p-a", quantity: 100, unitPrice: 425, taxRatePercent: 18, deliveryDate: null },
            { productId: "p-b", quantity: 50, unitPrice: 1250, taxRatePercent: 5, deliveryDate: null },
          ],
        }),
      },
    });

    prisma.purchaseOrder.findFirst.mockResolvedValueOnce(null);
    prisma.purchaseOrder.create.mockImplementation(async ({ data }: any) => ({
      id: "po-2",
      lineItems: data.lineItems.create.map((li: any, i: number) => ({
        id: `li-${i + 1}`,
        ...li,
        product: { name: `Product ${i}`, unit: "unit" },
      })),
      supplier: { id: "sup-1", companyName: "Supplier One" },
      builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
    }));

    const result = await service.create(userCtx, { orderId: "order-2" } as any);

    // 100 * 425 * 18% = 7650
    expect(result.lineItems[0]).toMatchObject({ productId: "p-a", unitPrice: 425, tax: 7650 });
    // 50 * 1250 * 5% = 3125
    expect(result.lineItems[1]).toMatchObject({ productId: "p-b", unitPrice: 1250, tax: 3125 });
  });

  // Immutability: supplier submits ₹425, catalogue price later changes to
  // ₹450 — PO generation reads only OrderItem.unitPrice (already frozen at
  // ₹425 by quote acceptance) and must never consult/re-resolve the
  // catalogue price.
  it("never falls back to a changed catalogue price — only reads OrderItem.unitPrice", async () => {
    const { service, prisma } = buildService({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-3",
          quoteSelectionCompletedAt: new Date(),
          selectedSupplierId: "sup-1",
          paymentMethod: "UPI",
          bestPriceTotal: null,
          tentativeDeliveryDate: null,
          items: [
            // Simulates: catalogue price is now 450, but the accepted
            // OrderItem.unitPrice remains 425 — this service has no
            // product/catalogue lookup at all, so it cannot regress.
            { productId: "p1", quantity: 10, unitPrice: 425, taxRatePercent: 18, deliveryDate: null },
          ],
        }),
      },
    });

    prisma.purchaseOrder.findFirst.mockResolvedValueOnce(null);
    prisma.purchaseOrder.create.mockImplementation(async ({ data }: any) => ({
      id: "po-3",
      lineItems: data.lineItems.create.map((li: any) => ({ id: "li-1", ...li, product: { name: "Cement", unit: "bag" } })),
      supplier: { id: "sup-1", companyName: "Supplier One" },
      builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
    }));

    const result = await service.create(userCtx, { orderId: "order-3" } as any);
    expect(result.lineItems[0].unitPrice).toBe(425);
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

// supplier_po_alert trigger — verifies the WhatsApp notification is only
// ever scheduled at the real DRAFT -> ISSUED transition performed by
// `approve()`, never at PO creation (see `create()` above, which always
// persists PurchaseOrderStatus.DRAFT and never calls this service).
describe("PurchaseOrdersService.approve — supplier_po_alert trigger", () => {
  function draftPo(overrides: Partial<any> = {}) {
    return {
      id: "po-1",
      poNumber: "PO-2026-00001",
      orderId: "order-1",
      supplierId: "sup-1",
      status: PurchaseOrderStatus.DRAFT,
      supplier: { id: "sup-1", companyName: "Supplier One", user: { whatsappNumber: null, phone: "919876543210" } },
      lineItems: [{ id: "li-1", quantity: 42, unitPrice: 100, tax: 0, product: { name: "Cement", unit: "bag" } }],
      ...overrides,
    };
  }

  beforeEach(() => {
    waitUntilMock.mockClear();
  });

  it("schedules the supplier_po_alert notification via waitUntil() exactly once the PO transitions DRAFT -> ISSUED", async () => {
    const { service, prisma, supplierPoReceivedNotificationService } = buildService();
    prisma.purchaseOrder.findFirst.mockResolvedValueOnce(draftPo());
    prisma.purchaseOrder.update.mockResolvedValueOnce({
      ...draftPo({ status: PurchaseOrderStatus.ISSUED }),
      builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
      order: { enquiryId: "ENQ-1" },
    });

    await service.approve(userCtx, "po-1", {} as any, {});

    expect(waitUntilMock).toHaveBeenCalledTimes(1);
    const scheduled = waitUntilMock.mock.calls[0][0];
    await scheduled;
    expect(supplierPoReceivedNotificationService.notify).toHaveBeenCalledWith("po-1");
  });

  it("rejects approving a PO that is not currently DRAFT, and never schedules a notification", async () => {
    const { service, prisma } = buildService();
    prisma.purchaseOrder.findFirst.mockResolvedValueOnce(draftPo({ status: PurchaseOrderStatus.ISSUED }));

    await expect(service.approve(userCtx, "po-1", {} as any, {})).rejects.toThrow(BadRequestException);
    expect(waitUntilMock).not.toHaveBeenCalled();
  });

  it("never throws/blocks approval even if the notification promise rejects", async () => {
    const { service, prisma, supplierPoReceivedNotificationService } = buildService();
    supplierPoReceivedNotificationService.notify.mockRejectedValueOnce(new Error("Meta down"));
    prisma.purchaseOrder.findFirst.mockResolvedValueOnce(draftPo());
    prisma.purchaseOrder.update.mockResolvedValueOnce({
      ...draftPo({ status: PurchaseOrderStatus.ISSUED }),
      builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
      order: { enquiryId: "ENQ-1" },
    });

    const result = await service.approve(userCtx, "po-1", {} as any, {});
    expect(result.status).toBe(PurchaseOrderStatus.ISSUED);

    const scheduled = waitUntilMock.mock.calls[0][0];
    await expect(scheduled).resolves.toBeUndefined();
  });
});
