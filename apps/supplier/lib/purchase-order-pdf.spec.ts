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
import { resolvePoDocumentView } from "./purchase-order-pdf";

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
