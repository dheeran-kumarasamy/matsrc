import { describe, expect, it, vi } from "vitest";
import { RfqsService } from "./rfqs.service";

// Mock of Vercel's waitUntil() — records every promise handed to it so
// tests can assert the quote_received notification work is *scheduled*
// (kept alive past the HTTP response) rather than fired off as a detached
// `void` promise that Vercel's serverless runtime may kill before it
// settles. Mirrors the identical mock already used in
// orders.service.spec.ts.
const { waitUntilMock } = vi.hoisted(() => ({ waitUntilMock: vi.fn() }));
vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}));

function createHarness(orderOverrides: Partial<any> = {}) {
  const createdRows: Array<any> = [];

  const prisma = {
    order: {
      findUnique: vi.fn().mockResolvedValue({
        id: "enq-1",
        status: "PLACED",
        quoteSelectionCompletedAt: null,
        items: [{ id: "line-1", supplierId: "sup-1", quantity: 10, taxRatePercent: null }],
        ...orderOverrides,
      }),
    },
    $transaction: vi.fn(async (callback: any) => {
      const tx = {
        supplierQuote: {
          create: vi.fn(async ({ data }: any) => {
            createdRows.push(data);
            return { id: `sq-${createdRows.length}`, unitPrice: data.unitPrice };
          }),
        },
      };

      return callback(tx);
    }),
    quickRequest: { findUnique: vi.fn() },
    quote: { create: vi.fn() },
  };

  const supplierContext = {
    getOrCreateSupplier: vi.fn().mockResolvedValue({ supplierProfile: { id: "sup-1" } }),
  };

  const bestPriceSelectionService = {
    selectAndFinalizeIfEligible: vi.fn().mockResolvedValue({
      enquiryId: "enq-1",
      selectedSupplierId: "sup-1",
      selectedSupplierName: "Supplier One",
      bestPriceTotal: 1200,
      tentativeDeliveryDate: new Date("2026-07-10T00:00:00Z"),
      lineItems: [
        { lineItemId: "line-1", supplierId: "sup-1", unitPrice: 120, currency: "INR", quantity: 10, materialName: "Cement OPC" },
      ],
      finalized: true,
    }),
  };

  const notificationService = { notifyBuilderBestPriceSelected: vi.fn().mockResolvedValue(undefined) };
  const whatsAppAlertService = { sendRfqQuoteReceived: vi.fn().mockResolvedValue(undefined) };
  const quoteReceivedNotificationService = { notify: vi.fn().mockResolvedValue(undefined) };

  const service = new RfqsService(
    prisma as any,
    supplierContext as any,
    bestPriceSelectionService as any,
    notificationService as any,
    whatsAppAlertService as any,
    quoteReceivedNotificationService as any
  );

  return { service, prisma, createdRows, bestPriceSelectionService, notificationService, quoteReceivedNotificationService };
}

const USER = { userId: "u-1", email: "sup@example.com", name: "Supplier" };

describe("RfqsService.createQuote", () => {
  it("persists line-item quotes, computes best price, and notifies builder", async () => {
    waitUntilMock.mockClear();
    const { service, createdRows, bestPriceSelectionService, notificationService, quoteReceivedNotificationService } =
      createHarness();

    await service.createQuote(
      "enq-1",
      { price: "120", lineQuotes: [{ lineItemId: "line-1", unitPrice: "120", leadTimeDays: 4 }] } as any,
      USER
    );

    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toMatchObject({
      enquiryId: "enq-1",
      supplierId: "sup-1",
      lineItemId: "line-1",
      unitPrice: 120,
      currency: "INR",
      leadTimeDays: 4,
    });

    expect(bestPriceSelectionService.selectAndFinalizeIfEligible).toHaveBeenCalledWith("enq-1");
    expect(notificationService.notifyBuilderBestPriceSelected).toHaveBeenCalledTimes(1);
    expect(notificationService.notifyBuilderBestPriceSelected).toHaveBeenCalledWith(
      expect.objectContaining({ enquiryId: "enq-1", bestPriceTotal: 1200 })
    );

    // quote_received (QUOTE_RECEIVED) notification is scheduled via
    // waitUntil() immediately after the SupplierQuote row(s) commit —
    // independent of best-price finalization above.
    expect(waitUntilMock).toHaveBeenCalledTimes(1);
    await waitUntilMock.mock.calls[0][0];
    expect(quoteReceivedNotificationService.notify).toHaveBeenCalledWith("enq-1", "sup-1", ["sq-1"]);
  });

  // Test 1 — Supplier can edit price / Test 2 — GST calculation
  it("computes and persists the server-side GST breakdown (quantity * unitPrice, GST, total)", async () => {
    const { service, createdRows } = createHarness();

    await service.createQuote(
      "enq-1",
      { price: "425", lineQuotes: [{ lineItemId: "line-1", unitPrice: "425" }] } as any,
      USER
    );

    expect(createdRows[0]).toMatchObject({
      quantity: 10,
      unitPrice: 425,
      gstRatePercent: 18, // DEFAULT_TAX_RATE_PERCENT — line item has no explicit taxRatePercent
      lineSubtotal: 4250,
      gstAmount: 765,
      lineTotal: 5015,
    });
  });

  // Test 4 — GST not applicable: an explicit 0% rate on the line item.
  it("honours an explicit 0% taxRatePercent as a genuine zero-GST line", async () => {
    const { service, createdRows } = createHarness({
      items: [{ id: "line-1", supplierId: "sup-1", quantity: 100, taxRatePercent: 0 }],
    });

    await service.createQuote(
      "enq-1",
      { price: "500", lineQuotes: [{ lineItemId: "line-1", unitPrice: "500" }] } as any,
      USER
    );

    expect(createdRows[0]).toMatchObject({ gstRatePercent: 0, lineSubtotal: 50000, gstAmount: 0, lineTotal: 50000 });
  });

  // Test 5 — Negative price
  it("rejects a negative quoted price", async () => {
    const { service } = createHarness();
    await expect(
      service.createQuote("enq-1", { price: "-100", lineQuotes: [{ lineItemId: "line-1", unitPrice: "-100" }] } as any, USER)
    ).rejects.toThrow(/non-negative number/);
  });

  // Test 6 — Invalid price
  it("rejects a non-numeric quoted price", async () => {
    const { service } = createHarness();
    await expect(
      service.createQuote("enq-1", { price: "abc", lineQuotes: [{ lineItemId: "line-1", unitPrice: "abc" }] } as any, USER)
    ).rejects.toThrow(/non-negative number/);
  });

  // Test 7 — Client-side total manipulation: the DTO has no total/grand-total
  // field, so there is nothing for the server to "trust" — it always
  // derives subtotal/GST/total itself from quantity * unitPrice.
  it("ignores any client-supplied total and always computes totals server-side", async () => {
    const { service, createdRows } = createHarness();

    await service.createQuote(
      "enq-1",
      { price: "400", lineQuotes: [{ lineItemId: "line-1", unitPrice: "400" }], grandTotal: "1" } as any,
      USER
    );

    expect(createdRows[0].lineSubtotal).toBe(4000);
    expect(createdRows[0].gstAmount).toBe(720);
    expect(createdRows[0].lineTotal).toBe(4720);
  });

  // Test 8 — Quantity manipulation: the DTO's QuoteLineItemDto has no
  // quantity field, so a client cannot submit one — the RFQ's own
  // OrderItem.quantity is always used.
  it("always uses the RFQ's own quantity, never a client-supplied value", async () => {
    const { service, createdRows } = createHarness({
      items: [{ id: "line-1", supplierId: "sup-1", quantity: 100, taxRatePercent: null }],
    });

    await service.createQuote(
      "enq-1",
      { price: "10", lineQuotes: [{ lineItemId: "line-1", unitPrice: "10", quantity: 1 } as any] } as any,
      USER
    );

    expect(createdRows[0].quantity).toBe(100);
    expect(createdRows[0].lineSubtotal).toBe(1000);
  });

  it("rejects quoting a line item the supplier is not assigned to", async () => {
    const { service } = createHarness({
      items: [{ id: "line-1", supplierId: "some-other-supplier", quantity: 10, taxRatePercent: null }],
    });

    await expect(
      service.createQuote("enq-1", { price: "100", lineQuotes: [{ lineItemId: "line-1", unitPrice: "100" }] } as any, USER)
    ).rejects.toThrow(/not authorized/);
  });

  it("rejects submission once the RFQ has already been finalized (quoteSelectionCompletedAt set)", async () => {
    const { service } = createHarness({ quoteSelectionCompletedAt: new Date("2026-01-01T00:00:00Z") });

    await expect(
      service.createQuote("enq-1", { price: "100", lineQuotes: [{ lineItemId: "line-1", unitPrice: "100" }] } as any, USER)
    ).rejects.toThrow(/no longer available for quotation/);
  });

  it("rejects submission against a cancelled enquiry", async () => {
    const { service } = createHarness({ status: "CANCELLED" });

    await expect(
      service.createQuote("enq-1", { price: "100", lineQuotes: [{ lineItemId: "line-1", unitPrice: "100" }] } as any, USER)
    ).rejects.toThrow(/no longer available for quotation/);
  });

  // Test 11 — Multiple line items: each retains its own independent GST breakdown.
  it("computes an independent GST breakdown per line item for multi-line submissions", async () => {
    const { service, createdRows } = createHarness({
      items: [
        { id: "line-a", supplierId: "sup-1", quantity: 100, taxRatePercent: 18 },
        { id: "line-b", supplierId: "sup-1", quantity: 10, taxRatePercent: 5 },
      ],
    });

    await service.createQuote(
      "enq-1",
      {
        price: "400",
        lineQuotes: [
          { lineItemId: "line-a", unitPrice: "400" },
          { lineItemId: "line-b", unitPrice: "2000" },
        ],
      } as any,
      USER
    );

    expect(createdRows).toHaveLength(2);
    expect(createdRows[0]).toMatchObject({ lineSubtotal: 40000, gstAmount: 7200, lineTotal: 47200 });
    expect(createdRows[1]).toMatchObject({ lineSubtotal: 20000, gstAmount: 1000, lineTotal: 21000 });
  });
});
