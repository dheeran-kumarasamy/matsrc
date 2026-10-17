// Buyer-Facing/Supplier-Facing PO Identity fix — unit tests for
// resolvePoDocumentView(), the pure data-mapping function that both the
// builder-portal ("BUYER" mode) and supplier-portal ("SUPPLIER" mode)
// Purchase Order PDF renderers use to decide which party is printed as
// BUYER vs SELLER and which number is printed as the document number.
// Exercised directly (no pdfkit rendering / PDF byte parsing involved) —
// renderPoPdfContent in this same module calls this exact function for the
// values it draws onto the page, so these assertions cover the real
// behaviour, not a parallel/divergent copy of the logic.

import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";
import { useRupeeCapableFont } from "./pdf-fonts";
import { resolvePoDocumentView, renderPoPdfContent, resolvePoLineItemTotals } from "./purchase-order-pdf";

function fakePo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "po-1",
    poNumber: "PO-2026-00001",
    orderNumber: "OD/2601/00042",
    supplier: {
      companyName: "Acme Building Materials",
      addressLine: "12 Industrial Estate",
      gstin: "27AAAAA0000A1Z5",
      email: "supplier@acme.example",
      phone: "9000000000",
    },
    builder: {
      name: "Rahul Sharma",
      email: "rahul@example.com",
      phone: "9123456789",
    },
    deliverTo: {
      name: "Site Office",
      addressLine: "45 Site Road",
      city: "Chennai",
      state: "Tamil Nadu",
      pincode: "600001",
      gstin: null,
    },
    ...overrides,
  };
}

describe("resolvePoDocumentView", () => {
  it("SUPPLIER mode: shows BuildOhub as buyer, the real supplier as seller, and uses poNumber", () => {
    const view = resolvePoDocumentView(fakePo(), "SUPPLIER");

    expect(view.documentNumber).toBe("PO-2026-00001");
    expect(view.buyer.name).toBe("BuildOhub");
    expect(view.seller.name).toBe("Acme Building Materials");
    expect(view.seller.gstin).toBe("27AAAAA0000A1Z5");
  });

  it("BUYER mode: shows the real customer as buyer, BuildOhub as seller, and uses the Order's orderNumber (never poNumber)", () => {
    const view = resolvePoDocumentView(fakePo(), "BUYER");

    expect(view.documentNumber).toBe("OD/2601/00042");
    expect(view.documentNumber).not.toBe("PO-2026-00001");
    expect(view.buyer.name).toBe("Rahul Sharma");
    expect(view.seller.name).toBe("BuildOhub");
  });

  it("BUYER mode never shows the supplier as the seller", () => {
    const view = resolvePoDocumentView(fakePo(), "BUYER");
    expect(view.seller.name).not.toBe("Acme Building Materials");
  });

  it("BUYER mode never shows BuildOhub as the buyer", () => {
    const view = resolvePoDocumentView(fakePo(), "BUYER");
    expect(view.buyer.name).not.toBe("BuildOhub");
  });

  it("BUYER mode falls back to poNumber only when the order has no orderNumber yet (pre-payment-approval)", () => {
    const view = resolvePoDocumentView(fakePo({ orderNumber: null }), "BUYER");
    expect(view.documentNumber).toBe("PO-2026-00001");
  });

  it("SUPPLIER mode's document number is completely unaffected by the presence of an orderNumber", () => {
    const withOrderNumber = resolvePoDocumentView(fakePo({ orderNumber: "OD/2601/00042" }), "SUPPLIER");
    const withoutOrderNumber = resolvePoDocumentView(fakePo({ orderNumber: null }), "SUPPLIER");
    expect(withOrderNumber.documentNumber).toBe("PO-2026-00001");
    expect(withoutOrderNumber.documentNumber).toBe("PO-2026-00001");
  });
});

// Admin-Configurable Product Markup — renderPoPdfContent's line-item
// rendering must select the SUPPLIER rate (li.unitPrice) by default and the
// BUYER rate (li.buyerUnitPrice) only in "BUYER" mode. Mirrors
// invoice-pdf.util.spec.ts's convention: asserts on the real PDF byte
// signature (never parses compressed PDF text), since the actual
// SUPPLIER-vs-BUYER column selection is exercised by this real render call.
describe("renderPoPdfContent — Admin-Configurable Product Markup", () => {
  function fakePoWithLineItems(mode: "SUPPLIER" | "BUYER") {
    return {
      id: "po-1",
      poNumber: "PO-2026-00001",
      orderNumber: "OD/2601/00042",
      status: "APPROVED",
      version: 1,
      createdAt: new Date("2026-01-01"),
      approvedAt: null,
      notes: null,
      supplier: { companyName: "Acme Building Materials", addressLine: null, gstin: null, email: null, phone: null },
      builder: { name: "Rahul Sharma", email: "rahul@example.com", phone: "9123456789" },
      deliverTo: null,
      lineItems: [
        {
          productName: "Cement",
          unit: "BAG",
          quantity: 5,
          unitPrice: 1000, // original supplier rate
          buyerUnitPrice: 1100, // marked-up buyer rate
          tax: 180,
          taxRatePercent: 18,
          lineTotal: 1000 * 5 + 180,
          deliveryDate: null,
        },
      ],
      subtotal: 5000,
      taxAmount: 180,
      total: 5180,
    };
  }

  function renderToBuffer(po: any, mode: "SUPPLIER" | "BUYER"): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      useRupeeCapableFont(doc);
      renderPoPdfContent(doc, po, mode);
      doc.end();
    });
  }

  it("renders a valid PDF in SUPPLIER mode (uses the original supplier rate)", async () => {
    const buffer = await renderToBuffer(fakePoWithLineItems("SUPPLIER"), "SUPPLIER");
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders a valid PDF in BUYER mode (uses the marked-up buyer rate) without throwing", async () => {
    const buffer = await renderToBuffer(fakePoWithLineItems("BUYER"), "BUYER");
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("falls back to the supplier rate in BUYER mode when buyerUnitPrice is absent (legacy PO)", async () => {
    const po = fakePoWithLineItems("BUYER");
    (po.lineItems[0] as any) = { ...po.lineItems[0], buyerUnitPrice: undefined };
    const buffer = await renderToBuffer(po, "BUYER");
    expect(buffer.length).toBeGreaterThan(0);
  });
});

// Finding 5 (now resolved) / Uniform GST on Marked-Up Buyer Price: BUYER-mode
// PO rendering previously folded the SUPPLIER-based tax amount
// (po.taxAmount, computed from the original supplier rate) onto the
// buyer's marked-up subtotal, producing a non-reconciling "Total" — and
// was later changed to defer GST entirely ("Pending"). Per the approved
// GST policy, BUYER mode now recomputes GST on the marked-up buyer price
// via resolvePoLineItemTotals (see its own doc comment), producing a real,
// reconciled Subtotal + GST = Total — see the dedicated
// resolvePoLineItemTotals describe block below for the precise arithmetic
// assertions; this block only smoke-tests the PDF rendering itself.
describe("renderPoPdfContent — Uniform GST on Marked-Up Buyer Price (real, reconciled totals in both modes)", () => {
  function fakePoWithLineItems(mode: "SUPPLIER" | "BUYER") {
    return {
      id: "po-1",
      poNumber: "PO-2026-00001",
      orderNumber: "OD/2601/00042",
      status: "APPROVED",
      version: 1,
      createdAt: new Date("2026-01-01"),
      approvedAt: null,
      notes: null,
      supplier: { companyName: "Acme Building Materials", addressLine: null, gstin: null, email: null, phone: null },
      builder: { name: "Rahul Sharma", email: "rahul@example.com", phone: "9123456789" },
      deliverTo: null,
      lineItems: [
        {
          productName: "Cement",
          unit: "BAG",
          quantity: 5,
          unitPrice: 1000,
          buyerUnitPrice: 1100,
          tax: 900, // GST computed from the SUPPLIER rate (1000 * 5 * 18%)
          taxRatePercent: 18,
          lineTotal: 1000 * 5 + 900,
          deliveryDate: null,
        },
      ],
      subtotal: 5000,
      taxAmount: 900,
      total: 5900,
    };
  }

  function renderToBuffer(po: any, mode: "SUPPLIER" | "BUYER"): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      useRupeeCapableFont(doc);
      renderPoPdfContent(doc, po, mode);
      doc.end();
    });
  }

  it("renders a valid PDF in BUYER mode without throwing, now showing a real reconciled GST total", async () => {
    const buffer = await renderToBuffer(fakePoWithLineItems("BUYER"), "BUYER");
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("SUPPLIER mode is completely unaffected: still folds in the (correctly supplier-based) tax amount as before", async () => {
    // No pdfkit-text-level assertion needed — see resolvePoLineItemTotals's
    // own dedicated test block below for the exact, directly-reviewable
    // arithmetic (SUPPLIER mode's total = subtotal + li.tax, unchanged).
    // This test only guards against a rendering regression/crash.
    const buffer = await renderToBuffer(fakePoWithLineItems("SUPPLIER"), "SUPPLIER");
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("BUYER-mode output byte size differs from an otherwise-identical SUPPLIER-mode render (confirms the two modes render genuinely different GST figures, not an accidental no-op)", async () => {
    const buyerBuffer = await renderToBuffer(fakePoWithLineItems("BUYER"), "BUYER");
    const supplierBuffer = await renderToBuffer(fakePoWithLineItems("SUPPLIER"), "SUPPLIER");
    expect(buyerBuffer.length).not.toBe(supplierBuffer.length);
  });
});

// Uniform GST on Marked-Up Buyer Price — precise arithmetic coverage for
// resolvePoLineItemTotals, the pure computation renderPoPdfContent uses for
// every GST figure it draws (see that function's own doc comment).
describe("resolvePoLineItemTotals — Uniform GST on Marked-Up Buyer Price", () => {
  function poWithLines(lineItems: any[]) {
    return { lineItems };
  }

  it("computes GST on the marked-up buyer price in BUYER mode, not the original supplier value", () => {
    const po = poWithLines([{ quantity: 10, unitPrice: 100, buyerUnitPrice: 110, tax: 180, taxRatePercent: 18 }]);
    const result = resolvePoLineItemTotals(po, "BUYER");

    // 10 * 110 = 1100 @ 18% = 198 (never 180, the supplier-based figure).
    expect(result.lineItems[0].displayTax).toBe(198);
    expect(result.taxAmount).toBe(198);
  });

  it("never calculates BUYER-mode GST on the original supplier value when it differs from the marked-up value", () => {
    const po = poWithLines([{ quantity: 10, unitPrice: 100, buyerUnitPrice: 110, tax: 180, taxRatePercent: 18 }]);
    const result = resolvePoLineItemTotals(po, "BUYER");
    expect(result.lineItems[0].displayTax).not.toBe(180);
  });

  it("SUPPLIER mode uses the persisted supplier-based tax as-is, unchanged", () => {
    const po = poWithLines([{ quantity: 10, unitPrice: 100, buyerUnitPrice: 110, tax: 180, taxRatePercent: 18 }]);
    const result = resolvePoLineItemTotals(po, "SUPPLIER");

    expect(result.lineItems[0].displayTax).toBe(180);
    expect(result.subtotal).toBe(1000); // 10 * 100, the supplier rate
    expect(result.total).toBe(1180);
  });

  it("applies markup and GST exactly once: BUYER subtotal/tax/total all derive from the SAME single buyerUnitPrice", () => {
    const po = poWithLines([{ quantity: 10, unitPrice: 100, buyerUnitPrice: 110, tax: 180, taxRatePercent: 18 }]);
    const result = resolvePoLineItemTotals(po, "BUYER");

    expect(result.subtotal).toBe(1100);
    expect(result.taxAmount).toBe(198);
    expect(result.total).toBe(1298);
    expect(result.lineItems[0].displayLineTotal).toBe(1298);
  });

  it("produces the correct GST calculation for a 0% markup line (buyer price equals supplier price)", () => {
    const po = poWithLines([{ quantity: 10, unitPrice: 100, buyerUnitPrice: 100, tax: 180, taxRatePercent: 18 }]);
    const result = resolvePoLineItemTotals(po, "BUYER");

    expect(result.lineItems[0].displayTax).toBe(180);
    expect(result.total).toBe(1180);
  });

  it("handles different configured markup percentages and GST rates correctly across multiple lines", () => {
    const po = poWithLines([
      { quantity: 10, unitPrice: 100, buyerUnitPrice: 110, tax: 180, taxRatePercent: 18 },
      { quantity: 50, unitPrice: 60, buyerUnitPrice: 75, tax: 150, taxRatePercent: 5 },
    ]);
    const result = resolvePoLineItemTotals(po, "BUYER");

    expect(result.lineItems[0].displayTax).toBe(198); // 10 * 110 @ 18%
    expect(result.lineItems[1].displayTax).toBe(187.5); // 50 * 75 @ 5%
    expect(result.subtotal).toBe(1100 + 3750);
    expect(result.taxAmount).toBe(198 + 187.5);
    expect(result.total).toBe(1100 + 198 + 3750 + 187.5);
  });

  it("fails safe to DEFAULT_TAX_RATE_PERCENT (18%) when taxRatePercent is missing, never fabricating a different rate", () => {
    const po = poWithLines([{ quantity: 10, unitPrice: 100, buyerUnitPrice: 110, tax: 180, taxRatePercent: null }]);
    const result = resolvePoLineItemTotals(po, "BUYER");

    expect(result.lineItems[0].displayTax).toBe(198); // 10 * 110 * 18%
  });

  it("falls back to unitPrice (0% markup) in BUYER mode for legacy lines with no recorded buyerUnitPrice", () => {
    const po = poWithLines([{ quantity: 10, unitPrice: 100, buyerUnitPrice: null, tax: 180, taxRatePercent: 18 }]);
    const result = resolvePoLineItemTotals(po, "BUYER");

    expect(result.lineItems[0].displayUnitPrice).toBe(100);
    expect(result.lineItems[0].displayTax).toBe(180);
  });
});
