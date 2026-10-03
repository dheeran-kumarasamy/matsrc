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

describe("RfqsService.createQuote", () => {
  it("persists line-item quotes, computes best price, and notifies builder", async () => {
    waitUntilMock.mockClear();
    const createdRows: Array<any> = [];

    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: "enq-1",
          items: [{ id: "line-1" }],
        }),
      },
      $transaction: vi.fn(async (callback: any) => {
        const tx = {
          supplierQuote: {
            create: vi.fn(async ({ data }: any) => {
              createdRows.push(data);
              return { id: "sq-1", unitPrice: data.unitPrice };
            }),
          },
        };

        return callback(tx);
      }),
      quickRequest: {
        findUnique: vi.fn(),
      },
      quote: {
        create: vi.fn(),
      },
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
          {
            lineItemId: "line-1",
            supplierId: "sup-1",
            unitPrice: 120,
            currency: "INR",
            quantity: 10,
            materialName: "Cement OPC",
          },
        ],
        finalized: true,
      }),
    };

    const notificationService = {
      notifyBuilderBestPriceSelected: vi.fn().mockResolvedValue(undefined),
    };

    const whatsAppAlertService = {
      sendRfqQuoteReceived: vi.fn().mockResolvedValue(undefined),
    };

    const quoteReceivedNotificationService = {
      notify: vi.fn().mockResolvedValue(undefined),
    };

    const service = new RfqsService(
      prisma as any,
      supplierContext as any,
      bestPriceSelectionService as any,
      notificationService as any,
      whatsAppAlertService as any,
      quoteReceivedNotificationService as any
    );


    await service.createQuote(
      "enq-1",
      {
        price: "120",
        lineQuotes: [{ lineItemId: "line-1", unitPrice: "120", leadTimeDays: 4 }],
      } as any,
      { userId: "u-1", email: "sup@example.com", name: "Supplier" }
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
      expect.objectContaining({
        enquiryId: "enq-1",
        bestPriceTotal: 1200,
      })
    );

    // quote_received (QUOTE_RECEIVED) notification is scheduled via
    // waitUntil() immediately after the SupplierQuote row(s) commit —
    // independent of best-price finalization above.
    expect(waitUntilMock).toHaveBeenCalledTimes(1);
    await waitUntilMock.mock.calls[0][0];
    expect(quoteReceivedNotificationService.notify).toHaveBeenCalledWith("enq-1", "sup-1", ["sq-1"]);
  });
});
