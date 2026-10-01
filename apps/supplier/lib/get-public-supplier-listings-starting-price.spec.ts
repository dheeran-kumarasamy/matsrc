// Regression test for the /products "Starting from ₹X" bug: the actual
// production data flow — prisma.product.findMany() (with pricingTiers
// included) -> getPublicSupplierListings() -> the `startingPrice` field on
// the public listings API response — must compute the true minimum valid
// price across ALL suppliers in a canonical group AND ALL of their price
// tiers, not just a base/default tier or a single supplier's price.
//
// This exercises the REAL production function (getPublicSupplierListings in
// ./supplier-data.ts), not just the pure resolveMinimumDisplayPrice() helper
// in isolation — per the corrective-implementation requirement to trace and
// test the actual end-to-end data path (Prisma query -> mapping ->
// cross-supplier grouping -> the field the frontend consumes), catching bugs
// that a helper-only unit test would miss (e.g. a query that only selects
// the default tier, or a mapping step that drops sibling suppliers before
// the minimum is computed).

import { describe, it, expect, vi, beforeEach } from "vitest";

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
    // supplier-data.ts imports this at module load time — not exercised by
    // this test (no status transition occurs here), but must be present so
    // the mocked @matsrc/db module satisfies the real import.
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
    category: { name: "TMT Steel" },
    brandRef: null,
    brand: "TestBrand",
    grade: "Fe500",
    unit: "KG",
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
});

describe("getPublicSupplierListings — startingPrice (product-listing price display)", () => {
  it("REQUIREMENT EXAMPLE: 3 suppliers, multiple tiers each -> global min ₹850 (Supplier B's non-default tier)", async () => {
    productRows.push(
      makeProduct({
        id: "p-a",
        supplierId: "supplier-a",
        canonicalProductId: "canon-1",
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 1000 },
          { minQty: 10, maxQty: 49, tierPrice: 950 },
          { minQty: 50, maxQty: 1000, tierPrice: 900 },
        ],
      }),
      makeProduct({
        id: "p-b",
        supplierId: "supplier-b",
        canonicalProductId: "canon-1",
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 980 },
          { minQty: 10, maxQty: 49, tierPrice: 920 },
          { minQty: 50, maxQty: 1000, tierPrice: 850 },
        ],
      }),
      makeProduct({
        id: "p-c",
        supplierId: "supplier-c",
        canonicalProductId: "canon-1",
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 1050 },
          { minQty: 10, maxQty: 1000, tierPrice: 970 },
        ],
      })
    );

    const listings = await getPublicSupplierListings();
    expect(listings.every((l: any) => l.startingPrice === 850)).toBe(true);
    // Must NOT show only a default-tier / single-supplier minimum.
    expect(listings.some((l: any) => l.startingPrice === 980)).toBe(false);
  });

  it("Case 1 — lowest price is from a different supplier (single tier each): A=₹1000, B=₹800 -> ₹800", async () => {
    productRows.push(
      makeProduct({ id: "p-a", supplierId: "supplier-a", canonicalProductId: "canon-2", basePrice: 1000, pricingTiers: [] }),
      makeProduct({ id: "p-b", supplierId: "supplier-b", canonicalProductId: "canon-2", basePrice: 800, pricingTiers: [] })
    );

    const listings = await getPublicSupplierListings();
    expect(listings.every((l: any) => l.startingPrice === 800)).toBe(true);
  });

  it("Case 2 — lowest price is from a non-default tier of the same supplier: Tier1=₹1000, Tier2=₹700 -> ₹700", async () => {
    productRows.push(
      makeProduct({
        id: "p-a",
        supplierId: "supplier-a",
        canonicalProductId: "canon-3",
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 1000 },
          { minQty: 10, maxQty: 1000, tierPrice: 700 },
        ],
      })
    );

    const listings = await getPublicSupplierListings();
    expect(listings[0].startingPrice).toBe(700);
  });

  it("Case 3 — lowest price is from a different supplier's non-default tier: A(1000/900), B(950/650) -> ₹650", async () => {
    productRows.push(
      makeProduct({
        id: "p-a",
        supplierId: "supplier-a",
        canonicalProductId: "canon-4",
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 1000 },
          { minQty: 10, maxQty: 1000, tierPrice: 900 },
        ],
      }),
      makeProduct({
        id: "p-b",
        supplierId: "supplier-b",
        canonicalProductId: "canon-4",
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 950 },
          { minQty: 10, maxQty: 1000, tierPrice: 650 },
        ],
      })
    );

    const listings = await getPublicSupplierListings();
    expect(listings.every((l: any) => l.startingPrice === 650)).toBe(true);
  });

  it("Case 4 — no active candidates -> empty listings array (existing unavailable behaviour preserved)", async () => {
    productRows.length = 0;

    const listings = await getPublicSupplierListings();
    expect(listings).toEqual([]);
  });

  it("Case 4b — active product but only zero/negative tier prices -> startingPrice is null, never ₹0", async () => {
    productRows.push(
      makeProduct({
        id: "p-a",
        supplierId: "supplier-a",
        canonicalProductId: "canon-5b",
        pricingTiers: [{ minQty: 1, maxQty: 10, tierPrice: 0 }],
      })
    );

    const listings = await getPublicSupplierListings();
    expect(listings[0].startingPrice).toBeNull();
  });

  it("Case 5 — multiple independent products: each product's startingPrice is computed from only its own group, never leaking across products", async () => {
    productRows.push(
      makeProduct({
        id: "p-a1",
        supplierId: "supplier-a",
        canonicalProductId: "canon-cement",
        name: "Cement",
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 400 },
          { minQty: 10, maxQty: 1000, tierPrice: 350 },
        ],
      }),
      makeProduct({
        id: "p-a2",
        supplierId: "supplier-b",
        canonicalProductId: "canon-cement",
        name: "Cement",
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 420 },
          { minQty: 10, maxQty: 1000, tierPrice: 300 },
        ],
      }),
      makeProduct({
        id: "p-b1",
        supplierId: "supplier-a",
        canonicalProductId: "canon-tmt",
        name: "TMT Bar",
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 60000 },
          { minQty: 10, maxQty: 1000, tierPrice: 55000 },
        ],
      }),
      makeProduct({
        id: "p-b2",
        supplierId: "supplier-b",
        canonicalProductId: "canon-tmt",
        name: "TMT Bar",
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 61000 },
          { minQty: 10, maxQty: 1000, tierPrice: 58000 },
        ],
      })
    );

    const listings = await getPublicSupplierListings();
    const cementListings = listings.filter((l: any) => l.name === "Cement");
    const tmtListings = listings.filter((l: any) => l.name === "TMT Bar");

    expect(cementListings.every((l: any) => l.startingPrice === 300)).toBe(true);
    expect(tmtListings.every((l: any) => l.startingPrice === 55000)).toBe(true);
    expect(cementListings.some((l: any) => l.startingPrice === 55000)).toBe(false);
    expect(tmtListings.some((l: any) => l.startingPrice === 300)).toBe(false);
  });

  it("does not fall back to only the first/default tier when a lower price exists later, out of order, in the array", async () => {
    // Regression guard against a `tiers[0]` / find-first-match-only bug:
    // pricingTiers intentionally NOT sorted ascending by price, to prove the
    // true minimum (not merely the first element) is picked.
    productRows.push(
      makeProduct({
        id: "p-a",
        supplierId: "supplier-a",
        canonicalProductId: "canon-6",
        pricingTiers: [
          { minQty: 1, maxQty: 9, tierPrice: 500 },
          { minQty: 10, maxQty: 49, tierPrice: 620 },
          { minQty: 50, maxQty: 1000, tierPrice: 410 },
        ],
      })
    );

    const listings = await getPublicSupplierListings();
    expect(listings[0].startingPrice).toBe(410);
  });
});
