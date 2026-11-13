// S15 — Supplier portal customer-facing Order ID fix.
//
// Unit tests for the canonical orderNumber ?? enquiryId ?? placeholder
// fallback rule in ./order-display.ts, independent of any Prisma/data-layer
// wiring (that wiring is covered separately in
// supplier-order-display-identifier.spec.ts).

import { describe, it, expect } from "vitest";
import { resolveSupplierOrderReference, NO_ORDER_REFERENCE_LABEL } from "./order-display";

describe("resolveSupplierOrderReference", () => {
  it("Case 1 — prefers orderNumber when both orderNumber and enquiryId exist", () => {
    expect(
      resolveSupplierOrderReference({
        orderNumber: "OD/2627/01/00001",
        enquiryId: "EQ/2627/01/00001",
      })
    ).toBe("OD/2627/01/00001");
  });

  it("Case 2 — falls back to enquiryId when orderNumber has not yet been generated", () => {
    expect(
      resolveSupplierOrderReference({
        orderNumber: null,
        enquiryId: "EQ/2627/01/00001",
      })
    ).toBe("EQ/2627/01/00001");
  });

  it("Case 3 — falls back to a legacy enquiryId format unchanged", () => {
    expect(
      resolveSupplierOrderReference({
        orderNumber: null,
        enquiryId: "ABC-SITE01-000123",
      })
    ).toBe("ABC-SITE01-000123");
  });

  it("Case 4 — never exposes the internal cuid; falls back to a neutral placeholder when neither business ID exists", () => {
    const result = resolveSupplierOrderReference({ orderNumber: null, enquiryId: null });
    expect(result).toBe(NO_ORDER_REFERENCE_LABEL);
    expect(result).not.toMatch(/^c[a-z0-9]{20,}$/i); // never looks like a cuid
  });

  it("treats undefined the same as null for both fields", () => {
    expect(resolveSupplierOrderReference({})).toBe(NO_ORDER_REFERENCE_LABEL);
  });
});
