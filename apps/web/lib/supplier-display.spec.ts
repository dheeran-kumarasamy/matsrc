import { describe, expect, it } from "vitest";
import { getSupplierDisplayName, HIDE_SUPPLIER_NAMES } from "./supplier-display";

describe("supplier-display", () => {
  it("anonymizes supplier names to Supplier 1, Supplier 2 consistently when HIDE_SUPPLIER_NAMES is true", () => {
    if (HIDE_SUPPLIER_NAMES) {
      const sup1 = getSupplierDisplayName("Ultratech Cement", "sup-100");
      const sup2 = getSupplierDisplayName("Tata Tiscon", "sup-200");
      const sup1Repeat = getSupplierDisplayName("Ultratech Cement", "sup-100");

      expect(sup1).toMatch(/^Supplier \d+$/);
      expect(sup2).toMatch(/^Supplier \d+$/);
      expect(sup1).toEqual(sup1Repeat);
      expect(sup1).not.toEqual(sup2);
    }
  });

  it("handles fallback index when no supplier identifier is provided", () => {
    if (HIDE_SUPPLIER_NAMES) {
      expect(getSupplierDisplayName("", "", 3)).toBe("Supplier 4");
    }
  });
});
