import { describe, it, expect } from "vitest";
import { formatProductPrice, formatCurrency } from "./currency-formatting";

describe("formatProductPrice", () => {
  it("formats whole number prices without decimals (ignored when 0)", () => {
    expect(formatProductPrice(1250)).toBe("₹1,250");
    expect(formatProductPrice("1250")).toBe("₹1,250");
    expect(formatProductPrice("1250.00")).toBe("₹1,250");
    expect(formatProductPrice(0)).toBe("₹0");
    expect(formatProductPrice("0.00")).toBe("₹0");
  });

  it("formats decimal prices with exactly two decimal places when non-zero", () => {
    expect(formatProductPrice(1250.5)).toBe("₹1,250.50");
    expect(formatProductPrice("1250.50")).toBe("₹1,250.50");
    expect(formatProductPrice(1250.75)).toBe("₹1,250.75");
    expect(formatProductPrice(0.5)).toBe("₹0.50");
    expect(formatProductPrice(0.05)).toBe("₹0.05");
  });

  it("supports large numbers with Indian digit grouping", () => {
    expect(formatProductPrice(150000)).toBe("₹1,50,000");
    expect(formatProductPrice(150000.5)).toBe("₹1,50,000.50");
  });

  it("supports Prisma Decimal objects with .toNumber()", () => {
    expect(formatProductPrice({ toNumber: () => 500 })).toBe("₹500");
    expect(formatProductPrice({ toNumber: () => 500.25 })).toBe("₹500.25");
  });

  it("handles negative prices cleanly", () => {
    expect(formatProductPrice(-250)).toBe("-₹250");
    expect(formatProductPrice(-250.5)).toBe("-₹250.50");
  });

  it("handles null, undefined, and empty string safely", () => {
    expect(formatProductPrice(null)).toBe("");
    expect(formatProductPrice(undefined)).toBe("");
    expect(formatProductPrice("")).toBe("");
  });
});

describe("formatCurrency", () => {
  it("always formats whole numbers with two decimal places", () => {
    expect(formatCurrency(1250)).toBe("₹1,250.00");
    expect(formatCurrency("1250")).toBe("₹1,250.00");
    expect(formatCurrency(0)).toBe("₹0.00");
    expect(formatCurrency("0")).toBe("₹0.00");
  });

  it("formats non-zero decimals with two decimal places", () => {
    expect(formatCurrency(1250.5)).toBe("₹1,250.50");
    expect(formatCurrency("1250.50")).toBe("₹1,250.50");
    expect(formatCurrency(1250.75)).toBe("₹1,250.75");
    expect(formatCurrency(0.5)).toBe("₹0.50");
  });

  it("supports large numbers with Indian digit grouping and two decimal places", () => {
    expect(formatCurrency(150000)).toBe("₹1,50,000.00");
    expect(formatCurrency(150000.5)).toBe("₹1,50,000.50");
  });

  it("supports Prisma Decimal objects with .toNumber()", () => {
    expect(formatCurrency({ toNumber: () => 1000 })).toBe("₹1,000.00");
    expect(formatCurrency({ toNumber: () => 1000.5 })).toBe("₹1,000.50");
  });

  it("handles negative amounts cleanly for refunds/discounts", () => {
    expect(formatCurrency(-150)).toBe("-₹150.00");
    expect(formatCurrency(-150.5)).toBe("-₹150.50");
  });

  it("handles null, undefined, and empty string safely", () => {
    expect(formatCurrency(null)).toBe("");
    expect(formatCurrency(undefined)).toBe("");
    expect(formatCurrency("")).toBe("");
  });
});
