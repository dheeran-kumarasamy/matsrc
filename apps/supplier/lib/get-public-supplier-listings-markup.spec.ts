// Admin-Configurable Product Markup — PLP/PDP display price fix regression
// coverage: `/products` and the product detail page previously showed the
// supplier's own raw price even when a non-zero markup was configured
// (only the cart/checkout applied markup). This file proves
// getPublicSupplierListings() now applies the SAME PRODUCT -> CATEGORY ->
// GLOBAL markup precedence to its DISPLAY fields (price/pricingTiers/
// startingPrice/headlinePrice/minPrice/maxPrice), while leaving the
// cart-add/checkout RESOLUTION fields (basePriceRaw/pricingTiersRaw)
// completely untouched (never double-marked-up there).
//
// Same harness pattern as get-public-supplier-listings-starting-price.spec.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { productRows, markupRows } = vi.hoisted(() => {
  return { productRows: [] as any[], markupRows: [] as any[] };
});

vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    prisma: {
      product: {
        findMany: vi.fn(() => Promise.resolve(productRows)),
      },
      markupSetting: {
        findMany: vi.fn(() => Promise.resolve(markupRows)),
      },
    },
    notifyCustomerOrderStatusChanged: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("./twilio-whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));

import { getPublicSupplierListings } from "./supplier-data";

function makeProduct(overrides: Partial<any> & { id: string; supplierId: string }) {
  return {
    id: overrides.id,
    supplierId: overrides.supplierId,
    categoryId: overrides.categoryId ?? "cat-1",
    canonicalProductId: overrides.canonicalProductId ?? null,
    name: overrides.name ?? "Test Product",
    category: { name: "Cement" },
    brandRef: null,
    brand: "TestBrand",
    grade: "OPC53",
    unit: "BAG",
    basePrice: overrides.basePrice ?? 1000,
    stock: overrides.stock ?? 1000,
    maxServiceableQty: overrides.maxServiceableQty ?? 1000,
    isActive: overrides.isActive ?? true,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    images: [],
    pricingTiers: overrides.pricingTiers ?? [],
  };
}

beforeEach(() => {
  productRows.length = 0;
  markupRows.length = 0;
});

describe("getPublicSupplierListings — markup applied to display prices", () => {
  it("applies a 10% GLOBAL markup to the display price/pricingTiers/startingPrice", async () => {
    markupRows.push({ scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true });
    productRows.push(
      makeProduct({
        id: "p-a",
        supplierId: "supplier-a",
        basePrice: 1000,
        pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 1000 }],
      })
    );

    const [listing] = await getPublicSupplierListings();

    expect(listing.price).toContain("1,100");
    expect(listing.pricingTiers[0].price).toBe("1100");
    expect(listing.startingPrice).toBe(1100);
  });

  it("never marks up the basePriceRaw/pricingTiersRaw fields used by cart-add/checkout resolution", async () => {
    markupRows.push({ scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true });
    productRows.push(
      makeProduct({
        id: "p-a",
        supplierId: "supplier-a",
        basePrice: 1000,
        pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 1000 }],
      })
    );

    const [listing] = await getPublicSupplierListings();

    expect(listing.basePriceRaw).toBe(1000);
    expect(listing.pricingTiersRaw[0].tierPrice).toBe(1000);
  });

  it("a PRODUCT-level override takes precedence over GLOBAL for that product's display price", async () => {
    markupRows.push(
      { scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true },
      { scope: "PRODUCT", scopeId: "p-a", percentage: 25, isEnabled: true }
    );
    productRows.push(
      makeProduct({ id: "p-a", supplierId: "supplier-a", basePrice: 1000, pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 1000 }] }),
      makeProduct({ id: "p-b", supplierId: "supplier-b", basePrice: 1000, pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 1000 }] })
    );

    const listings = await getPublicSupplierListings();
    const a = listings.find((l: any) => l.id === "p-a");
    const b = listings.find((l: any) => l.id === "p-b");

    expect(a.startingPrice).toBe(1250); // 25% PRODUCT override
    expect(b.startingPrice).toBe(1100); // 10% GLOBAL fallback
  });

  it("a CATEGORY-level override applies to every product in that category, falling back to GLOBAL for others", async () => {
    markupRows.push(
      { scope: "GLOBAL", scopeId: null, percentage: 5, isEnabled: true },
      { scope: "CATEGORY", scopeId: "cat-cement", percentage: 20, isEnabled: true }
    );
    productRows.push(
      makeProduct({ id: "p-a", supplierId: "supplier-a", categoryId: "cat-cement", basePrice: 1000, pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 1000 }] }),
      makeProduct({ id: "p-b", supplierId: "supplier-b", categoryId: "cat-steel", basePrice: 1000, pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 1000 }] })
    );

    const listings = await getPublicSupplierListings();
    const a = listings.find((l: any) => l.id === "p-a");
    const b = listings.find((l: any) => l.id === "p-b");

    expect(a.startingPrice).toBe(1200); // 20% CATEGORY
    expect(b.startingPrice).toBe(1050); // 5% GLOBAL fallback
  });

  it("a disabled markup tier falls through to the next tier exactly like an unset one", async () => {
    markupRows.push(
      { scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true },
      { scope: "PRODUCT", scopeId: "p-a", percentage: 50, isEnabled: false }
    );
    productRows.push(
      makeProduct({ id: "p-a", supplierId: "supplier-a", basePrice: 1000, pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 1000 }] })
    );

    const [listing] = await getPublicSupplierListings();
    expect(listing.startingPrice).toBe(1100); // disabled PRODUCT override skipped -> GLOBAL
  });

  it("no markup configuration anywhere leaves the display price identical to the supplier's raw price", async () => {
    productRows.push(
      makeProduct({ id: "p-a", supplierId: "supplier-a", basePrice: 1000, pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 1000 }] })
    );

    const [listing] = await getPublicSupplierListings();
    expect(listing.startingPrice).toBe(1000);
    expect(listing.price).toContain("1,000");
  });

  it("applies markup consistently across a cross-supplier canonical group's headline/min/max display prices", async () => {
    markupRows.push({ scope: "GLOBAL", scopeId: null, percentage: 10, isEnabled: true });
    productRows.push(
      makeProduct({
        id: "p-a",
        supplierId: "supplier-a",
        canonicalProductId: "canon-1",
        basePrice: 1000,
        pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 1000 }],
      }),
      makeProduct({
        id: "p-b",
        supplierId: "supplier-b",
        canonicalProductId: "canon-1",
        basePrice: 800,
        pricingTiers: [{ minQty: 1, maxQty: 1000, tierPrice: 800 }],
      })
    );

    const listings = await getPublicSupplierListings();
    const a = listings.find((l: any) => l.id === "p-a");

    // Headline/min/max should reflect the marked-up prices (880/1100), not
    // the raw supplier prices (800/1000).
    expect(a.minPrice).toBe(880);
    expect(a.maxPrice).toBe(1100);
    expect(a.headlinePrice).toContain("880");
  });
});
