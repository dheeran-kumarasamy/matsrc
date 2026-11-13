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
      findMany: vi.fn(),
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
          status: "PROCESSING",
          quoteSelectionCompletedAt: new Date(),
          selectedSupplierId: "sup-1",
          paymentMethod: "UPI",
          bestPriceTotal: null,
          tentativeDeliveryDate: null,
          items: [
            { productId: "p1", quantity: 42, unitPrice: 100, supplierId: "sup-1", deliveryDate: null },
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
          status: "PROCESSING",
          quoteSelectionCompletedAt: new Date(),
          selectedSupplierId: "sup-1",
          paymentMethod: "UPI",
          bestPriceTotal: null,
          tentativeDeliveryDate: null,
          items: [
            // unitPrice (425) is the ACCEPTED supplier quote — distinct
            // from any hypothetical catalogue price (400), which this
            // service must never read.
            { productId: "p1", quantity: 100, unitPrice: 425, supplierId: "sup-1", taxRatePercent: 18, deliveryDate: null },
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
          status: "PROCESSING",
          quoteSelectionCompletedAt: new Date(),
          selectedSupplierId: "sup-1",
          paymentMethod: "UPI",
          bestPriceTotal: null,
          tentativeDeliveryDate: null,
          items: [
            { productId: "p-a", quantity: 100, unitPrice: 425, supplierId: "sup-1", taxRatePercent: 18, deliveryDate: null },
            { productId: "p-b", quantity: 50, unitPrice: 1250, supplierId: "sup-1", taxRatePercent: 5, deliveryDate: null },
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
          status: "PROCESSING",
          quoteSelectionCompletedAt: new Date(),
          selectedSupplierId: "sup-1",
          paymentMethod: "UPI",
          bestPriceTotal: null,
          tentativeDeliveryDate: null,
          items: [
            // Simulates: catalogue price is now 450, but the accepted
            // OrderItem.unitPrice remains 425 — this service has no
            // product/catalogue lookup at all, so it cannot regress.
            { productId: "p1", quantity: 10, unitPrice: 425, supplierId: "sup-1", taxRatePercent: 18, deliveryDate: null },
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

// Purchase-Order Generation Eligibility (Phase 5B) — replaces the previous
// quoteSelectionCompletedAt/selectedSupplierId-only gate. These tests cover
// every genuine confirmation path's actual persisted shape (see
// isPurchaseOrderEligibleOrderStatus's own doc comment in
// purchase-orders.service.ts), NOT just the two RFQ-style paths that happen
// to also set the legacy RFQ-selection fields.
describe("PurchaseOrdersService.create — Purchase-Order Generation Eligibility", () => {
  it("allows PO creation for an order confirmed through OrdersService.updateStatus (PROCESSING, no quoteSelectionCompletedAt/selectedSupplierId)", async () => {
    const { service, prisma } = buildService({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-us",
          status: "PROCESSING",
          // The exact, documented Phase 3B gap: OrdersService.updateStatus
          // never sets these two fields on a genuine confirmation.
          quoteSelectionCompletedAt: null,
          selectedSupplierId: null,
          paymentMethod: "UPI",
          bestPriceTotal: null,
          tentativeDeliveryDate: null,
          items: [{ productId: "p1", quantity: 10, unitPrice: 425, supplierId: "sup-1", taxRatePercent: 18, deliveryDate: null }],
        }),
      },
    });

    prisma.purchaseOrder.findFirst.mockResolvedValueOnce(null);
    prisma.purchaseOrder.create.mockImplementation(async ({ data }: any) => ({
      id: "po-us",
      lineItems: data.lineItems.create.map((li: any, i: number) => ({ id: `li-${i + 1}`, ...li, product: { name: "Cement", unit: "bag" } })),
      supplier: { id: "sup-1", companyName: "Supplier One" },
      builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
    }));

    const result = await service.create(userCtx, { orderId: "order-us" } as any);

    // Supplier resolved from OrderItem.supplierId, never fabricated.
    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ supplierId: "sup-1" }) })
    );
    expect(result.lineItems[0].unitPrice).toBe(425);
  });

  it("allows PO creation for an order confirmed through PaymentsService.approve (PROCESSING, no RFQ-selection fields)", async () => {
    const { service, prisma } = buildService({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-pay",
          status: "PROCESSING",
          quoteSelectionCompletedAt: null,
          selectedSupplierId: null,
          paymentMethod: "BANK_TRANSFER",
          bestPriceTotal: null,
          tentativeDeliveryDate: null,
          items: [{ productId: "p1", quantity: 5, unitPrice: 200, supplierId: "sup-2", taxRatePercent: 18, deliveryDate: null }],
        }),
      },
    });

    prisma.purchaseOrder.findFirst.mockResolvedValueOnce(null);
    prisma.purchaseOrder.create.mockImplementation(async ({ data }: any) => ({
      id: "po-pay",
      lineItems: data.lineItems.create.map((li: any, i: number) => ({ id: `li-${i + 1}`, ...li, product: { name: "Steel", unit: "kg" } })),
      supplier: { id: "sup-2", companyName: "Supplier Two" },
      builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
    }));

    const result = await service.create(userCtx, { orderId: "order-pay" } as any);

    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ supplierId: "sup-2" }) })
    );
    expect(result.lineItems[0].unitPrice).toBe(200);
  });

  it("continues to work for an order confirmed through the best-price/RFQ path (selectedSupplierId present)", async () => {
    const { service, prisma } = buildService({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-rfq",
          status: "PROCESSING",
          quoteSelectionCompletedAt: new Date(),
          selectedSupplierId: "sup-rfq",
          paymentMethod: "UPI",
          bestPriceTotal: 2000,
          tentativeDeliveryDate: null,
          items: [{ productId: "p1", quantity: 1, unitPrice: 2000, supplierId: "sup-rfq", taxRatePercent: 18, deliveryDate: null }],
        }),
      },
    });

    prisma.purchaseOrder.findFirst.mockResolvedValueOnce(null);
    prisma.purchaseOrder.create.mockImplementation(async ({ data }: any) => ({
      id: "po-rfq",
      lineItems: data.lineItems.create.map((li: any, i: number) => ({ id: `li-${i + 1}`, ...li, product: { name: "Sand", unit: "ton" } })),
      supplier: { id: "sup-rfq", companyName: "RFQ Supplier" },
      builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
    }));

    const result = await service.create(userCtx, { orderId: "order-rfq" } as any);

    expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ supplierId: "sup-rfq" }) })
    );
    expect(result.lineItems[0].unitPrice).toBe(2000);
  });

  it("rejects an unconfirmed order still in PLACED status", async () => {
    const { service, prisma } = buildService({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-placed",
          status: "PLACED",
          quoteSelectionCompletedAt: null,
          selectedSupplierId: null,
          items: [{ productId: "p1", quantity: 1, unitPrice: 100, supplierId: "sup-1", deliveryDate: null }],
        }),
      },
    });

    await expect(service.create(userCtx, { orderId: "order-placed" } as any)).rejects.toThrow(BadRequestException);
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it("rejects a cancelled order with a distinct error message", async () => {
    const { service, prisma } = buildService({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-cancelled",
          status: "CANCELLED",
          quoteSelectionCompletedAt: null,
          selectedSupplierId: null,
          items: [{ productId: "p1", quantity: 1, unitPrice: 100, supplierId: "sup-1", deliveryDate: null }],
        }),
      },
    });

    await expect(service.create(userCtx, { orderId: "order-cancelled" } as any)).rejects.toMatchObject({
      message: expect.stringContaining("cancelled"),
    });
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it("rejects an order whose line items span multiple suppliers when selectedSupplierId is absent", async () => {
    const { service, prisma } = buildService({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-multi",
          status: "PROCESSING",
          quoteSelectionCompletedAt: null,
          selectedSupplierId: null,
          items: [
            { productId: "p1", quantity: 1, unitPrice: 100, supplierId: "sup-1", deliveryDate: null },
            { productId: "p2", quantity: 1, unitPrice: 100, supplierId: "sup-2", deliveryDate: null },
          ],
        }),
      },
    });

    await expect(service.create(userCtx, { orderId: "order-multi" } as any)).rejects.toThrow(BadRequestException);
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it("remains idempotent — returns the existing PO without re-checking eligibility against a stale status", async () => {
    const { service, prisma } = buildService({
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-existing",
          status: "PROCESSING",
          quoteSelectionCompletedAt: null,
          selectedSupplierId: null,
          items: [{ productId: "p1", quantity: 1, unitPrice: 100, supplierId: "sup-1", deliveryDate: null }],
        }),
      },
    });

    prisma.purchaseOrder.findFirst.mockResolvedValueOnce({
      id: "po-existing",
      lineItems: [{ id: "li-1", productId: "p1", quantity: 1, unitPrice: 100, tax: 18, product: { name: "Cement", unit: "bag" } }],
      supplier: { id: "sup-1", companyName: "Supplier One" },
      builder: { id: "builder-1", name: "Builder One", email: "builder@example.com" },
    });

    const result = await service.create(userCtx, { orderId: "order-existing" } as any);

    expect(result.id).toBe("po-existing");
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
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

// Uniform GST on Marked-Up Buyer Price — regression coverage for
// PurchaseOrdersService.serialize() (private, exercised via findAll/findOne),
// the builder (buyer)-facing serialization mirroring apps/web's
// lib/purchase-order-utils.ts serializePurchaseOrder exactly.
function fakePoRow(lineItems: any[]) {
  return {
    id: "po-1",
    poNumber: "PO-2026-00001",
    status: PurchaseOrderStatus.ISSUED,
    version: 1,
    notes: null,
    termsSnapshot: null,
    approvedAt: null,
    approvedBy: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    orderId: "order-1",
    order: { enquiryId: "ABC-SITE01-000001" },
    supplier: { id: "sup-1", companyName: "Acme" },
    builder: { id: "builder-1", name: "Rahul", email: "rahul@example.com" },
    lineItems,
  };
}

describe("PurchaseOrdersService.findAll — Uniform GST on Marked-Up Buyer Price", () => {
  it("computes GST on the marked-up buyer price, not the original supplier value", async () => {
    const { service, prisma } = buildService();
    prisma.purchaseOrder.findMany.mockResolvedValueOnce([
      fakePoRow([
        {
          id: "li-1",
          productId: "prod-1",
          product: { name: "Cement", unit: "BAG" },
          quantity: 10,
          unitPrice: 100,
          buyerUnitPrice: 110,
          markupPercent: 10,
          markupAmount: 10,
          tax: 180,
          taxRatePercent: 18,
          deliveryDate: null,
          fulfilledQuantity: 0,
        },
      ]),
    ]);

    const [result] = await service.findAll(userCtx);

    // Buyer rate 110 * 18% = 19.80 per unit * 10 qty = 198 (never 180).
    expect(result.lineItems[0].tax).toBe(198);
    expect(result.taxAmount).toBe(198);
    expect(result.subtotal).toBe(1100);
    expect(result.total).toBe(1298);
  });

  it("preserves the original supplier unitPrice/tax separately, never overwritten", async () => {
    const { service, prisma } = buildService();
    prisma.purchaseOrder.findMany.mockResolvedValueOnce([
      fakePoRow([
        {
          id: "li-1",
          productId: "prod-1",
          product: { name: "Cement", unit: "BAG" },
          quantity: 10,
          unitPrice: 100,
          buyerUnitPrice: 110,
          markupPercent: 10,
          markupAmount: 10,
          tax: 180,
          taxRatePercent: 18,
          deliveryDate: null,
          fulfilledQuantity: 0,
        },
      ]),
    ]);

    const [result] = await service.findAll(userCtx);

    expect(result.lineItems[0].originalUnitPrice).toBe(100);
    expect(result.lineItems[0].originalTax).toBe(180);
  });

  it("falls back to unitPrice (0% markup) for legacy lines with no recorded buyerUnitPrice", async () => {
    const { service, prisma } = buildService();
    prisma.purchaseOrder.findMany.mockResolvedValueOnce([
      fakePoRow([
        {
          id: "li-1",
          productId: "prod-1",
          product: { name: "Cement", unit: "BAG" },
          quantity: 10,
          unitPrice: 100,
          buyerUnitPrice: null,
          markupPercent: null,
          markupAmount: null,
          tax: 180,
          taxRatePercent: 18,
          deliveryDate: null,
          fulfilledQuantity: 0,
        },
      ]),
    ]);

    const [result] = await service.findAll(userCtx);

    expect(result.lineItems[0].unitPrice).toBe(100);
    expect(result.lineItems[0].tax).toBe(180);
    expect(result.lineItems[0].markupPercent).toBe(0);
  });
});
