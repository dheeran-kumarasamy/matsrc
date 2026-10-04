// S04/S09 regression test — base-price/tier-pricing consistency across
// Product page / Cart / Checkout / Order.
//
// Root cause (see supplier-data.ts's getPublicSupplierListings() doc
// comment at the `basePriceRaw`/`stockRaw`/`maxServiceableQtyRaw`/
// `pricingTiersRaw` fields): the public listings API computed these raw
// numeric fields under an underscore-prefixed name
// (_basePriceRaw/_stockRaw/_maxServiceableQtyRaw/_pricingTiersRaw) for its
// OWN internal cross-supplier resolution, then stripped them out of the
// public JSON response entirely. apps/web's cart-add
// (app/api/builder/cart/items/route.ts) and checkout re-resolution
// (lib/order-checkout.ts) read these same values under the NON-prefixed
// names — which were therefore always `undefined`, silently collapsing
// every tier-aware price resolution down to an implicit single tier at
// basePrice. This test proves the public API response now actually
// contains the supplier's real basePrice/PricingTier data under the field
// names apps/web consumes.
//
// Same harness pattern as get-public-supplier-listings-starting-price.spec.ts.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { productRows } = vi.hoisted(() => {
  return { productRows: [] as any[] };
});

vi.mock("@matsrc/db", () => {
  return {
    prisma: {
      product: {
        findMany: vi.fn(() => Promise.resolve(productRows)),
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
    canonicalProductId: overrides.canonicalProductId ?? null,
    name: overrides.name ?? "Test Product",
    category: { name: "Cement" },
    brandRef: null,
    brand: "JSW",
    grade: "OPC53",
    unit: "BAG",
    basePrice: overrides.basePrice ?? 100,
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
});

describe("getPublicSupplierListings — S04/S09 raw pricing fields reach the public response", () => {
  it("exposes basePriceRaw matching the supplier-entered Product.basePrice exactly (no base-price drift)", async () => {
    productRows.push(makeProduct({ id: "p-1", supplierId: "supplier-1", basePrice: 500 }));

    const listings = await getPublicSupplierListings();

    expect(listings[0].basePriceRaw).toBe(500);
  });

  it("exposes pricingTiersRaw with the exact existing tier configuration — tier values/thresholds unchanged", async () => {
    productRows.push(
      makeProduct({
        id: "p-2",
        supplierId: "supplier-2",
        basePrice: 100,
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 100 },
          { minQty: 10, maxQty: 999, tierPrice: 90 },
        ],
      })
    );

    const listings = await getPublicSupplierListings();

    expect(listings[0].pricingTiersRaw).toEqual([
      { minQty: 1, maxQty: 9, tierPrice: 100 },
      { minQty: 10, maxQty: 999, tierPrice: 90 },
    ]);
  });

  it("falls back to a single implicit tier at basePrice when the supplier configured no explicit tiers (unchanged existing behaviour)", async () => {
    productRows.push(
      makeProduct({ id: "p-3", supplierId: "supplier-3", basePrice: 250, maxServiceableQty: 500, pricingTiers: [] })
    );

    const listings = await getPublicSupplierListings();

    expect(listings[0].pricingTiersRaw).toEqual([{ minQty: 1, maxQty: 500, tierPrice: 250 }]);
    expect(listings[0].basePriceRaw).toBe(250);
  });

  it("exposes stockRaw and maxServiceableQtyRaw as real numbers, not formatted strings", async () => {
    productRows.push(
      makeProduct({ id: "p-4", supplierId: "supplier-4", stock: 777, maxServiceableQty: 777 })
    );

    const listings = await getPublicSupplierListings();

    expect(listings[0].stockRaw).toBe(777);
    expect(listings[0].maxServiceableQtyRaw).toBe(777);
  });

  it("keeps each supplier's raw pricing fields isolated — Supplier A's basePrice never leaks onto Supplier B's listing", async () => {
    productRows.push(
      makeProduct({ id: "p-a", supplierId: "supplier-a", canonicalProductId: "canon-1", basePrice: 300 }),
      makeProduct({ id: "p-b", supplierId: "supplier-b", canonicalProductId: "canon-1", basePrice: 450 })
    );

    const listings = await getPublicSupplierListings();

    const a = listings.find((l: any) => l.supplierId === "supplier-a");
    const b = listings.find((l: any) => l.supplierId === "supplier-b");

    expect(a.basePriceRaw).toBe(300);
    expect(b.basePriceRaw).toBe(450);
  });

  it("does not alter the existing cross-supplier startingPrice computation (tier-resolution logic untouched)", async () => {
    productRows.push(
      makeProduct({
        id: "p-x",
        supplierId: "supplier-x",
        canonicalProductId: "canon-2",
        basePrice: 1000,
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 1000 },
          { minQty: 10, maxQty: 1000, tierPrice: 850 },
        ],
      })
    );

    const listings = await getPublicSupplierListings();

    // Pre-existing behaviour (see get-public-supplier-listings-starting-price.spec.ts) — unaffected by this fix.
    expect(listings[0].startingPrice).toBe(850);
    // New: the raw fields now also reach the response.
    expect(listings[0].basePriceRaw).toBe(1000);
    expect(listings[0].pricingTiersRaw).toEqual([
      { minQty: 1, maxQty: 9, tierPrice: 1000 },
      { minQty: 10, maxQty: 1000, tierPrice: 850 },
    ]);
  });
});
