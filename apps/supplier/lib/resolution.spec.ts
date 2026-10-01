import { describe, it, expect } from "vitest";
import { resolveMinimumDisplayPrice, type ResolutionCandidate } from "./resolution";

// Regression coverage for the /products PLP "Starting from ₹Xxx" display
// price requirement: the displayed price must be the minimum VALID price
// across ALL suppliers offering the product AND ALL of their price tiers —
// never a min–max range, never a fabricated ₹0.

function candidate(overrides: Partial<ResolutionCandidate>): ResolutionCandidate {
  return {
    listingId: "listing-1",
    supplierId: "supplier-1",
    basePrice: 100,
    stock: 1000,
    maxServiceableQty: 1000,
    pricingTiers: [],
    isActive: true,
    ...overrides,
  };
}

describe("resolveMinimumDisplayPrice", () => {
  it("returns the lower of two suppliers' single-tier prices (Supplier A ₹550, Supplier B ₹500 -> ₹500)", () => {
    const candidates = [
      candidate({ listingId: "a", supplierId: "supplier-a", basePrice: 550, pricingTiers: [] }),
      candidate({ listingId: "b", supplierId: "supplier-b", basePrice: 500, pricingTiers: [] }),
    ];

    expect(resolveMinimumDisplayPrice(candidates)).toBe(500);
  });

  it("finds the lowest price across one supplier's multiple tiers (Tier 1 ₹550, Tier 2 ₹480 -> ₹480)", () => {
    const candidates = [
      candidate({
        pricingTiers: [
          { minQty: 1, maxQty: 99, tierPrice: 550 },
          { minQty: 100, maxQty: 1000, tierPrice: 480 },
        ],
      }),
    ];

    expect(resolveMinimumDisplayPrice(candidates)).toBe(480);
  });

  it("finds the global minimum across multiple suppliers AND multiple tiers (A: 550/520, B: 575/495 -> ₹495)", () => {
    const candidates = [
      candidate({
        listingId: "a",
        supplierId: "supplier-a",
        pricingTiers: [
          { minQty: 1, maxQty: 49, tierPrice: 550 },
          { minQty: 50, maxQty: 500, tierPrice: 520 },
        ],
      }),
      candidate({
        listingId: "b",
        supplierId: "supplier-b",
        pricingTiers: [
          { minQty: 1, maxQty: 49, tierPrice: 575 },
          { minQty: 50, maxQty: 500, tierPrice: 495 },
        ],
      }),
      candidate({
        listingId: "c",
        supplierId: "supplier-c",
        pricingTiers: [{ minQty: 1, maxQty: 500, tierPrice: 525 }],
      }),
    ];

    expect(resolveMinimumDisplayPrice(candidates)).toBe(495);
  });

  it("surfaces a lower price that only exists in a non-default, higher-quantity tier", () => {
    const candidates = [
      candidate({
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 600 },
          { minQty: 10, maxQty: 99, tierPrice: 590 },
          { minQty: 100, maxQty: 1000, tierPrice: 410 },
        ],
      }),
    ];

    expect(resolveMinimumDisplayPrice(candidates)).toBe(410);
  });

  it("ignores inactive suppliers entirely, even if they quote a lower price", () => {
    const candidates = [
      candidate({ listingId: "a", supplierId: "supplier-a", basePrice: 500, isActive: true }),
      candidate({ listingId: "b", supplierId: "supplier-b", basePrice: 100, isActive: false }),
    ];

    expect(resolveMinimumDisplayPrice(candidates)).toBe(500);
  });

  it("falls back to basePrice as an implicit single tier when a candidate has no explicit pricingTiers", () => {
    const candidates = [candidate({ basePrice: 333, pricingTiers: [] })];
    expect(resolveMinimumDisplayPrice(candidates)).toBe(333);
  });

  it("returns null when there are no candidates at all", () => {
    expect(resolveMinimumDisplayPrice([])).toBeNull();
  });

  it("returns null when every candidate is inactive", () => {
    const candidates = [
      candidate({ isActive: false, basePrice: 100 }),
      candidate({ isActive: false, basePrice: 200 }),
    ];
    expect(resolveMinimumDisplayPrice(candidates)).toBeNull();
  });

  it("never treats a zero or negative tier price as a valid minimum (no fabricated ₹0)", () => {
    const candidates = [
      candidate({
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 0 },
          { minQty: 10, maxQty: 99, tierPrice: -50 },
          { minQty: 100, maxQty: 1000, tierPrice: 300 },
        ],
      }),
    ];

    expect(resolveMinimumDisplayPrice(candidates)).toBe(300);
  });

  it("returns null when every eligible candidate's every tier is invalid (all zero/negative)", () => {
    const candidates = [
      candidate({ pricingTiers: [{ minQty: 1, maxQty: 10, tierPrice: 0 }] }),
    ];
    expect(resolveMinimumDisplayPrice(candidates)).toBeNull();
  });
});
