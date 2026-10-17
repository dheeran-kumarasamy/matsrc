// Supplier RFQ Price Revision & GST-Inclusive Order Value.
//
// Covers createSupplierQuote's new `lineQuotes` path
// (createEnquiryLineQuotesForSupplier), mirroring the existing
// supplier-data.ts test mocking pattern (mock @matsrc/db so no real
// database is touched).

import { describe, it, expect, vi, beforeEach } from "vitest";

const { orderRows, supplierQuoteRows, orderItemUpdateCalls, orderUpdateCalls, markupByProductId } = vi.hoisted(() => ({
  orderRows: new Map<string, any>(),
  supplierQuoteRows: [] as any[],
  orderItemUpdateCalls: [] as any[],
  orderUpdateCalls: [] as any[],
  // Admin-Configurable Product Markup: productId -> markup result the test
  // wants resolveMarkupForProduct to return for that line. Defaults to null
  // (no config -> 0% fail-safe fallback) unless a test explicitly seeds one.
  markupByProductId: new Map<string, any>(),
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
            // Order-Total Synchronization: returns every OrderItem belonging
            // to the enquiry currently being quoted, reflecting the
            // just-applied updates above, so the fix's totalAmount resync
            // can be exercised realistically.
            findMany: vi.fn(async (args: any) => {
              const order = Array.from(orderRows.values()).find((o) =>
                o.items.some((i: any) => i.id === args?.where?.orderId) || o.id === args?.where?.orderId
              );
              const baseItems = order ? order.items : [];
              return baseItems.map((item: any) => {
                const updated = orderItemUpdateCalls.find((c) => c.where.id === item.id);
                return {
                  unitPrice: updated ? updated.data.unitPrice : item.unitPrice ?? 0,
                  quantity: item.quantity,
                };
              });
            }),
          },
          order: {
            update: vi.fn(async (args: any) => {
              orderUpdateCalls.push(args);
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
    // Admin-Configurable Product Markup: real resolution logic (product ->
    // category -> global precedence, explicit-0%-vs-unset) is already
    // covered by packages/db/lib/markup-calculation.spec.ts — this mock
    // only needs to simulate "the configured markup for this product",
    // seeded per-test via markupByProductId, with the same
    // null-on-missing-config fail-safe contract as the real function.
    resolveMarkupForProduct: vi.fn(async (_tx: any, params: { productId: string; supplierUnitPrice: number }) => {
      const configured = markupByProductId.get(params.productId);
      if (!configured) return null;
      const buyerUnitPrice = Math.round((params.supplierUnitPrice * (1 + configured.markupPercent / 100) + Number.EPSILON) * 100) / 100;
      return {
        supplierUnitPrice: params.supplierUnitPrice,
        buyerUnitPrice,
        markupPercent: configured.markupPercent,
        markupAmount: Math.round((buyerUnitPrice - params.supplierUnitPrice + Number.EPSILON) * 100) / 100,
      };
    }),
  };
});

vi.mock("./twilio-whatsapp", () => ({ sendWhatsAppMessage: vi.fn(() => Promise.resolve({})) }));

import { createSupplierQuote } from "./supplier-data";

beforeEach(() => {
  orderRows.clear();
  supplierQuoteRows.length = 0;
  orderItemUpdateCalls.length = 0;
  orderUpdateCalls.length = 0;
  markupByProductId.clear();
});

function seedOrder(id: string, overrides: Partial<any> = {}) {
  orderRows.set(id, {
    id,
    status: "PLACED",
    quoteSelectionCompletedAt: null,
    items: [
      { id: "line-1", productId: "prod-1", supplierId: "sup-1", quantity: 10, taxRatePercent: null, product: { categoryId: "cat-1" } },
    ],
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
  // Admin-Configurable Product Markup — UPDATED: previously this test
  // asserted the raw supplier quotation (425) as the correct
  // OrderItem.unitPrice. That assertion documented the Finding 1 bug (the
  // buyer was charged the supplier's own price with zero markup). Fixed
  // behaviour: with no markup configured (the default, 0% fail-safe
  // fallback), the buyer-facing price still legitimately equals the
  // supplier price — so this specific 0%-config case still asserts 425,
  // but now ALSO asserts supplierUnitPrice/markupPercent/markupAmount are
  // explicitly recorded as the frozen 0%-markup snapshot, never left
  // unset. See the dedicated markup tests below for the non-zero-markup
  // case, which proves the bug is actually fixed.
  it("updates OrderItem.unitPrice to the submitted quote price when no markup is configured (0% fail-safe)", async () => {
    seedOrder("enq-2");

    await createSupplierQuote(
      "enq-2",
      { price: "425", lineQuotes: [{ lineItemId: "line-1", unitPrice: "425" }] },
      "supplier@example.com"
    );

    expect(orderItemUpdateCalls).toHaveLength(1);
    expect(orderItemUpdateCalls[0]).toMatchObject({
      where: { id: "line-1" },
      data: { unitPrice: 425, supplierUnitPrice: 425, markupPercent: 0, markupAmount: 0 },
    });
  });

  // Admin-Configurable Product Markup — Finding 1 regression coverage.
  describe("Admin-Configurable Product Markup", () => {
    it("applies a 10% markup: buyer-facing OrderItem.unitPrice is marked up, SupplierQuote.unitPrice remains the original quote", async () => {
      seedOrder("enq-markup-10");
      markupByProductId.set("prod-1", { markupPercent: 10 });

      await createSupplierQuote(
        "enq-markup-10",
        { price: "1000", lineQuotes: [{ lineItemId: "line-1", unitPrice: "1000" }] },
        "supplier@example.com"
      );

      // The supplier's own quotation record must remain unmarked-up.
      expect(supplierQuoteRows[0]).toMatchObject({ unitPrice: 1000, buyerUnitPrice: 1100, markupPercent: 10, markupAmount: 100 });

      // The buyer-facing OrderItem must be marked up — never the raw ₹1,000 quote.
      expect(orderItemUpdateCalls[0]).toMatchObject({
        where: { id: "line-1" },
        data: { unitPrice: 1100, supplierUnitPrice: 1000, markupPercent: 10, markupAmount: 100 },
      });
    });

    it("honours an explicit 0% override distinctly from no configuration", async () => {
      seedOrder("enq-markup-0");
      markupByProductId.set("prod-1", { markupPercent: 0 });

      await createSupplierQuote(
        "enq-markup-0",
        { price: "500", lineQuotes: [{ lineItemId: "line-1", unitPrice: "500" }] },
        "supplier@example.com"
      );

      expect(orderItemUpdateCalls[0]).toMatchObject({
        data: { unitPrice: 500, supplierUnitPrice: 500, markupPercent: 0, markupAmount: 0 },
      });
    });

    it("applies a product-specific override (resolveMarkupForProduct is called with the line's own productId)", async () => {
      seedOrder("enq-markup-product", {
        items: [
          { id: "line-1", productId: "prod-special", supplierId: "sup-1", quantity: 10, taxRatePercent: null, product: { categoryId: "cat-1" } },
        ],
      });
      markupByProductId.set("prod-special", { markupPercent: 25 });

      await createSupplierQuote(
        "enq-markup-product",
        { price: "400", lineQuotes: [{ lineItemId: "line-1", unitPrice: "400" }] },
        "supplier@example.com"
      );

      expect(orderItemUpdateCalls[0]).toMatchObject({
        data: { unitPrice: 500, supplierUnitPrice: 400, markupPercent: 25, markupAmount: 100 },
      });
    });

    it("recalculates Order.totalAmount from the marked-up OrderItem price(s), never the stale/raw total", async () => {
      seedOrder("enq-markup-total");
      markupByProductId.set("prod-1", { markupPercent: 10 });

      await createSupplierQuote(
        "enq-markup-total",
        { price: "1000", lineQuotes: [{ lineItemId: "line-1", unitPrice: "1000" }] },
        "supplier@example.com"
      );

      const totalUpdate = orderUpdateCalls.find((c) => c.where.id === "enq-markup-total");
      expect(totalUpdate).toBeDefined();
      // quantity 10 * marked-up unit price 1100 = 11000 (never 10 * 1000 = 10000).
      expect(totalUpdate.data.totalAmount).toBe(11000);
    });

    it("never applies markup twice: a subsequent RFQ finalization cannot re-mark-up an already-marked-up OrderItem.unitPrice", async () => {
      // Once quoteSelectionCompletedAt is set (RFQ finalized), this function
      // itself refuses further submissions — the authoritative guard
      // against double markup for THIS code path (see the
      // "rejects submission once the RFQ has already been finalized" test
      // above, which already proves this). This test additionally confirms
      // that resolveMarkupForProduct is always called with the ORIGINAL
      // supplier-quoted price (never the previously-computed buyer price)
      // on a fresh, still-open RFQ.
      seedOrder("enq-markup-single-pass");
      markupByProductId.set("prod-1", { markupPercent: 10 });

      await createSupplierQuote(
        "enq-markup-single-pass",
        { price: "1000", lineQuotes: [{ lineItemId: "line-1", unitPrice: "1000" }] },
        "supplier@example.com"
      );

      const { resolveMarkupForProduct } = await import("@matsrc/db");
      expect(resolveMarkupForProduct).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ supplierUnitPrice: 1000 })
      );
      // Never called with the already-marked-up 1100 as the base.
      expect(resolveMarkupForProduct).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ supplierUnitPrice: 1100 })
      );
    });
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
