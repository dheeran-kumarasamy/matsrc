// Supplier RFQ Price Revision & GST-Inclusive Order Value.
//
// Covers createSupplierQuote's new `lineQuotes` path
// (createEnquiryLineQuotesForSupplier), mirroring the existing
// supplier-data.ts test mocking pattern (mock @matsrc/db so no real
// database is touched).

import { describe, it, expect, vi, beforeEach } from "vitest";

const { orderRows, supplierQuoteRows, orderItemUpdateCalls } = vi.hoisted(() => ({
  orderRows: new Map<string, any>(),
  supplierQuoteRows: [] as any[],
  orderItemUpdateCalls: [] as any[],
}));

vi.mock("@matsrc/db", () => {
  return {
    prisma: {
      user: {
        findUniqueOrThrow: vi.fn(() =>
          Promise.resolve({
            id: "user-1",
            name: "Acme",
            email: "supplier@example.com",
            phone: null,
            whatsappNumber: null,
            kycStatus: "APPROVED",
            supplierProfile: { id: "sup-1", companyName: "Acme", bisLicenceNo: null, region: null },
          })
        ),
      },
      order: {
        findUnique: vi.fn((args: any) => Promise.resolve(orderRows.get(args.where.id) ?? null)),
      },
      $transaction: vi.fn(async (callback: any) => {
        const tx = {
          supplierQuote: {
            create: vi.fn(async ({ data }: any) => {
              supplierQuoteRows.push(data);
              return { id: `sq-${supplierQuoteRows.length}`, unitPrice: data.unitPrice };
            }),
          },
          orderItem: {
            update: vi.fn(async (args: any) => {
              orderItemUpdateCalls.push(args);
              return {};
            }),
          },
        };
        return callback(tx);
      }),
    },
    notifyCustomerOrderStatusChanged: vi.fn(() => Promise.resolve()),
    notifyPaymentRequired: vi.fn(() => Promise.resolve()),
    calculateLineGst: (input: any) => {
      const gstRatePercent =
        typeof input.gstRatePercent === "number" && Number.isFinite(input.gstRatePercent) ? input.gstRatePercent : 18;
      const lineSubtotal = input.quantity * input.unitPrice;
      const gstAmount = (lineSubtotal * gstRatePercent) / 100;
      const lineTotal = lineSubtotal + gstAmount;
      const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
      return {
        quantity: input.quantity,
        unitPrice: round(input.unitPrice),
        gstRatePercent,
        lineSubtotal: round(lineSubtotal),
        gstAmount: round(gstAmount),
        lineTotal: round(lineTotal),
      };
    },
    parseQuotedPrice: (raw: any) => {
      if (raw === null || raw === undefined || raw === "") return null;
      const parsed = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    },
  };
});

vi.mock("./twilio-whatsapp", () => ({ sendWhatsAppMessage: vi.fn(() => Promise.resolve({})) }));

import { createSupplierQuote } from "./supplier-data";

beforeEach(() => {
  orderRows.clear();
  supplierQuoteRows.length = 0;
  orderItemUpdateCalls.length = 0;
});

function seedOrder(id: string, overrides: Partial<any> = {}) {
  orderRows.set(id, {
    id,
    status: "PLACED",
    quoteSelectionCompletedAt: null,
    items: [{ id: "line-1", supplierId: "sup-1", quantity: 10, taxRatePercent: null }],
    ...overrides,
  });
}

describe("createSupplierQuote — RFQ line-item quotation (lineQuotes path)", () => {
  // Test 1/2 — Supplier can edit price / GST calculation
  it("computes and persists the server-side GST breakdown for a supplier-edited price", async () => {
    seedOrder("enq-1");

    await createSupplierQuote(
      "enq-1",
      { price: "425", lineQuotes: [{ lineItemId: "line-1", unitPrice: "425" }] },
      "supplier@example.com"
    );

    expect(supplierQuoteRows).toHaveLength(1);
    expect(supplierQuoteRows[0]).toMatchObject({
      quantity: 10,
      unitPrice: 425,
      gstRatePercent: 18,
      lineSubtotal: 4250,
      gstAmount: 765,
      lineTotal: 5015,
    });
  });

  // Test 15/22 — order uses submitted quote price, not catalogue price.
  it("updates OrderItem.unitPrice to the submitted quote price", async () => {
    seedOrder("enq-2");

    await createSupplierQuote(
      "enq-2",
      { price: "425", lineQuotes: [{ lineItemId: "line-1", unitPrice: "425" }] },
      "supplier@example.com"
    );

    expect(orderItemUpdateCalls).toHaveLength(1);
    expect(orderItemUpdateCalls[0]).toMatchObject({ where: { id: "line-1" }, data: { unitPrice: 425 } });
  });

  // Test 5 — Negative price
  it("rejects a negative quoted price", async () => {
    seedOrder("enq-3");
    await expect(
      createSupplierQuote("enq-3", { price: "-10", lineQuotes: [{ lineItemId: "line-1", unitPrice: "-10" }] }, "supplier@example.com")
    ).rejects.toThrow(/non-negative number/);
  });

  // Test 6 — Invalid price
  it("rejects a non-numeric quoted price", async () => {
    seedOrder("enq-4");
    await expect(
      createSupplierQuote("enq-4", { price: "abc", lineQuotes: [{ lineItemId: "line-1", unitPrice: "abc" }] }, "supplier@example.com")
    ).rejects.toThrow(/non-negative number/);
  });

  it("rejects quoting a line item the supplier is not assigned to", async () => {
    seedOrder("enq-5", { items: [{ id: "line-1", supplierId: "someone-else", quantity: 10, taxRatePercent: null }] });
    await expect(
      createSupplierQuote("enq-5", { price: "100", lineQuotes: [{ lineItemId: "line-1", unitPrice: "100" }] }, "supplier@example.com")
    ).rejects.toThrow(/not authorized/);
  });

  it("rejects submission once the RFQ has already been finalized", async () => {
    seedOrder("enq-6", { quoteSelectionCompletedAt: new Date("2026-01-01T00:00:00Z") });
    await expect(
      createSupplierQuote("enq-6", { price: "100", lineQuotes: [{ lineItemId: "line-1", unitPrice: "100" }] }, "supplier@example.com")
    ).rejects.toThrow(/no longer available for quotation/);
  });

  it("rejects submission against a cancelled enquiry", async () => {
    seedOrder("enq-7", { status: "CANCELLED" });
    await expect(
      createSupplierQuote("enq-7", { price: "100", lineQuotes: [{ lineItemId: "line-1", unitPrice: "100" }] }, "supplier@example.com")
    ).rejects.toThrow(/no longer available for quotation/);
  });

  // Test 8 — Quantity manipulation: no quantity field exists on the line
  // input type, so there's nothing for the client to override — the RFQ's
  // own OrderItem.quantity is always used.
  it("always uses the RFQ's own quantity", async () => {
    seedOrder("enq-8", { items: [{ id: "line-1", supplierId: "sup-1", quantity: 250, taxRatePercent: 5 }] });

    await createSupplierQuote(
      "enq-8",
      { price: "10", lineQuotes: [{ lineItemId: "line-1", unitPrice: "10" }] },
      "supplier@example.com"
    );

    expect(supplierQuoteRows[0].quantity).toBe(250);
    expect(supplierQuoteRows[0].lineSubtotal).toBe(2500);
    expect(supplierQuoteRows[0].gstRatePercent).toBe(5);
  });
});
