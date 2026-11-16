import { describe, expect, it } from "vitest";
import { formatCurrency, formatProductPrice } from "./utils";

describe("API Supplier Utils Currency Formatting", () => {
  describe("formatProductPrice", () => {
    it("omits decimal places when fractional value is zero", () => {
      expect(formatProductPrice(1250)).toBe("₹1,250");
      expect(formatProductPrice(100)).toBe("₹100");
      expect(formatProductPrice(0)).toBe("₹0");
      expect(formatProductPrice("5000")).toBe("₹5,000");
    });

    it("displays two decimal places when fractional value is non-zero", () => {
      expect(formatProductPrice(1250.5)).toBe("₹1,250.50");
      expect(formatProductPrice(1250.25)).toBe("₹1,250.25");
      expect(formatProductPrice(99.99)).toBe("₹99.99");
    });

    it("handles negative numbers and edge cases", () => {
      expect(formatProductPrice(-45.5)).toBe("-₹45.50");
      expect(formatProductPrice(null)).toBe("");
      expect(formatProductPrice(undefined)).toBe("");
      expect(formatProductPrice("")).toBe("");
    });
  });

  describe("formatCurrency", () => {
    it("always displays two decimal places even when zero", () => {
      expect(formatCurrency(1250)).toBe("₹1,250.00");
      expect(formatCurrency(0)).toBe("₹0.00");
      expect(formatCurrency(100)).toBe("₹100.00");
      expect(formatCurrency("5000")).toBe("₹5,000.00");
    });

    it("displays two decimal places for fractional amounts", () => {
      expect(formatCurrency(1250.5)).toBe("₹1,250.50");
      expect(formatCurrency(1250.25)).toBe("₹1,250.25");
    });

    it("handles negative numbers and edge cases", () => {
      expect(formatCurrency(-45.5)).toBe("-₹45.50");
      expect(formatCurrency(null)).toBe("");
      expect(formatCurrency(undefined)).toBe("");
      expect(formatCurrency("")).toBe("");
    });
  });
});
