import { describe, it, expect, vi, beforeEach } from "vitest";

const { productRows, markupRows, mockFindFirst, mockFindMany, mockMarkupFindMany } = vi.hoisted(() => {
  const pRows: any[] = [];
  const mRows: any[] = [];

  const findFirstFn = vi.fn((args?: any) => {
    if (!args?.where) return Promise.resolve(pRows[0] ?? null);
    const found = pRows.find((p: any) => {
      if (args.where.isActive !== undefined && p.isActive !== args.where.isActive) {
        return false;
      }
      if (args.where.OR) {
        return args.where.OR.some(
          (cond: any) => cond.id === p.id || (cond.slug && (cond.slug === p.id || cond.slug === p.slug))
        );
      }
      if (args.where.id) return p.id === args.where.id;
      return true;
    });
    return Promise.resolve(found ? { ...found } : null);
  });

  const findManyFn = vi.fn((args?: any) => {
    if (args?.where?.canonicalProductId) {
      const filtered = pRows.filter(
        (p: any) =>
          p.canonicalProductId === args.where.canonicalProductId &&
          (args.where.isActive === undefined || p.isActive === args.where.isActive)
      );
      return Promise.resolve(filtered.map((p: any) => ({ ...p })));
    }
    return Promise.resolve(pRows.map((p: any) => ({ ...p })));
  });

  const markupFindManyFn = vi.fn((args?: any) => {
    if (!args?.where?.OR) return Promise.resolve(mRows);
    const matching = mRows.filter((row: any) => {
      return args.where.OR.some((clause: any) => {
        if (clause.scope === "GLOBAL" && row.scope === "GLOBAL") return true;
        if (clause.scope === "CATEGORY" && row.scope === "CATEGORY" && clause.scopeId?.in?.includes(row.scopeId))
          return true;
        if (clause.scope === "PRODUCT" && row.scope === "PRODUCT" && clause.scopeId?.in?.includes(row.scopeId))
          return true;
        return false;
      });
    });
    return Promise.resolve(matching);
  });

  return {
    productRows: pRows,
    markupRows: mRows,
    mockFindFirst: findFirstFn,
    mockFindMany: findManyFn,
    mockMarkupFindMany: markupFindManyFn,
  };
});

vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    prisma: {
      product: {
        findFirst: mockFindFirst,
        findMany: mockFindMany,
      },
      markupSetting: {
        findMany: mockMarkupFindMany,
      },
    },
    notifyCustomerOrderStatusChanged: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("./twilio-whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));

import { getPublicSupplierProductById } from "./supplier-data";
import { GET as getSingleProductApi } from "../app/api/public/listings/[id]/route";

function makeProduct(overrides: Partial<any> & { id: string }) {
  return {
    id: overrides.id,
    slug: overrides.slug ?? `slug-${overrides.id}`,
    supplierId: overrides.supplierId ?? "sup-1",
    categoryId: overrides.categoryId ?? "cat-cement",
    category: overrides.category ?? { id: "cat-cement", name: "Cement" },
    canonicalProductId: overrides.canonicalProductId ?? null,
    name: overrides.name ?? "UltraTech Super Cement 50kg",
    brandRef: overrides.brandRef ?? null,
    brand: overrides.brand ?? "UltraTech",
    grade: overrides.grade ?? "53 Grade",
    unit: overrides.unit ?? "BAG",
    basePrice: overrides.basePrice ?? 400,
    stock: overrides.stock ?? 500,
    maxServiceableQty: overrides.maxServiceableQty ?? 500,
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    updatedAt: overrides.updatedAt ?? new Date("2026-02-01T00:00:00.000Z"),
    images: overrides.images ?? ["https://example.com/cement.jpg"],
    pricingTiers: overrides.pricingTiers ?? [{ minQty: 1, maxQty: 500, tierPrice: overrides.basePrice ?? 400 }],
  };
}

beforeEach(() => {
  productRows.length = 0;
  markupRows.length = 0;
  mockFindFirst.mockClear();
  mockFindMany.mockClear();
  mockMarkupFindMany.mockClear();
});

describe("getPublicSupplierProductById — Targeted Database Lookup (Phase 1 Refinement)", () => {
  it("A. Invalid product ID returns null and exits immediately without loading catalogue or markups", async () => {
    productRows.push(
      makeProduct({ id: "prod-1", name: "Active Listing 1" }),
      makeProduct({ id: "prod-2", name: "Active Listing 2" })
    );

    const result = await getPublicSupplierProductById("non-existent-product-slug");

    expect(result).toBeNull();
    // 1. Must use targeted lookup on Product
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ id: "non-existent-product-slug" }, { slug: "non-existent-product-slug" }],
          isActive: true,
        }),
      })
    );
    // 2. Must NEVER load all products via findMany
    expect(mockFindMany).not.toHaveBeenCalled();
    // 3. Must NEVER calculate or query markups for unrelated products
    expect(mockMarkupFindMany).not.toHaveBeenCalled();
  });

  it("B. Valid single-listing product returns expected response and does NOT retrieve unrelated products", async () => {
    productRows.push(
      makeProduct({
        id: "prod-single",
        supplierId: "sup-single",
        canonicalProductId: null,
        basePrice: 420,
        images: ["https://example.com/single.jpg"],
      }),
      makeProduct({ id: "prod-other-1", canonicalProductId: null }),
      makeProduct({ id: "prod-other-2", canonicalProductId: "canon-unrelated" })
    );

    const result = await getPublicSupplierProductById("prod-single");

    expect(result).not.toBeNull();
    expect(result!.displayListing.id).toBe("prod-single");
    expect(result!.displayListing.supplierId).toBe("sup-single");
    expect(result!.displayListing.images).toEqual(["https://example.com/single.jpg"]);
    expect(result!.siblings).toHaveLength(1);
    expect(result!.siblings[0].id).toBe("prod-single");

    // Only the targeted findFirst was needed for an ungrouped listing (no sibling query required)
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("C. Grouped product retrieves ONLY the related listings in that canonical group", async () => {
    productRows.push(
      makeProduct({
        id: "prod-canon-1a",
        supplierId: "sup-expensive",
        canonicalProductId: "canon-cement",
        basePrice: 400,
        pricingTiers: [
          { minQty: 1, maxQty: 100, tierPrice: 400 },
          { minQty: 101, maxQty: 500, tierPrice: 380 },
        ],
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
        images: ["https://example.com/cement-a.jpg"],
      }),
      makeProduct({
        id: "prod-canon-1b",
        supplierId: "sup-cheaper",
        canonicalProductId: "canon-cement",
        basePrice: 390,
        pricingTiers: [{ minQty: 1, maxQty: 500, tierPrice: 390 }],
        updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        images: ["https://example.com/cement-b.jpg"],
      }),
      // Unrelated product from another group that MUST NOT be loaded or returned
      makeProduct({
        id: "prod-steel-1",
        supplierId: "sup-steel",
        canonicalProductId: "canon-steel",
        basePrice: 55000,
      })
    );

    const result = await getPublicSupplierProductById("prod-canon-1a");

    expect(result).not.toBeNull();
    // 1. Grouped listing IDs must contain exactly the two cement listings
    expect(result!.displayListing.groupedListingIds.slice().sort()).toEqual(["prod-canon-1a", "prod-canon-1b"]);
    // 2. Siblings array must include only members of this canonical group
    expect(result!.siblings).toHaveLength(2);
    expect(result!.siblings.map((s: any) => s.id).sort()).toEqual(["prod-canon-1a", "prod-canon-1b"]);
    // Unrelated steel product must NEVER be in siblings
    expect(result!.siblings.some((s: any) => s.id === "prod-steel-1")).toBe(false);

    // 3. Headline price should reflect the lowest unit price for qty=1 (sup-cheaper at ₹390)
    expect(result!.displayListing.headlineSupplierId).toBe("sup-cheaper");
    expect(result!.displayListing.headlinePrice).toContain("390");

    // 4. Starting price surfaces ₹380 from sup-expensive's bulk tier
    expect(result!.displayListing.startingPrice).toBe(380);

    // 5. Verification of targeted query:
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          canonicalProductId: "canon-cement",
          isActive: true,
        }),
      })
    );
  });

  it("D. Inactive or ineligible listing returns null and is not exposed", async () => {
    productRows.push(
      makeProduct({
        id: "prod-inactive",
        isActive: false,
      })
    );

    const result = await getPublicSupplierProductById("prod-inactive");

    expect(result).toBeNull();
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("E. Pricing and markup regression: applies correct buyer-facing markup while preserving raw numeric supplier fields", async () => {
    productRows.push(
      makeProduct({
        id: "prod-with-markup",
        categoryId: "cat-cement",
        basePrice: 500,
        pricingTiers: [
          { minQty: 1, maxQty: 50, tierPrice: 500 },
          { minQty: 51, maxQty: 200, tierPrice: 480 },
        ],
      })
    );

    // 10% markup configured globally
    markupRows.push({
      scope: "GLOBAL",
      scopeId: null,
      percentage: "10",
      isEnabled: true,
    });

    const result = await getPublicSupplierProductById("prod-with-markup");

    expect(result).not.toBeNull();
    const product = result!.displayListing;

    // Base price marked up by 10%: ₹500 + 10% = ₹550
    expect(product.price).toContain("550");

    // Marked-up pricing tiers for PLP/PDP display:
    // Tier 1: ₹500 + 10% = ₹550
    // Tier 2: ₹480 + 10% = ₹528
    expect(product.pricingTiers).toEqual([
      { minQty: "1", maxQty: "50", price: "550" },
      { minQty: "51", maxQty: "200", price: "528" },
    ]);

    // Raw fields for cart/checkout unit price resolution MUST remain untouched supplier values
    expect(product.basePriceRaw).toBe(500);
    expect(product.pricingTiersRaw).toEqual([
      { minQty: 1, maxQty: 50, tierPrice: 500 },
      { minQty: 51, maxQty: 200, tierPrice: 480 },
    ]);
  });

  it("F. API Route Compatibility: /api/public/listings/[id] returns 200 for valid ID and 404 for invalid ID", async () => {
    productRows.push(
      makeProduct({
        id: "prod-route-test",
        basePrice: 350,
      })
    );

    // 1. Valid listing test
    const validResponse = await getSingleProductApi(new Request("https://localhost/api/public/listings/prod-route-test"), {
      params: { id: "prod-route-test" },
    });
    expect(validResponse.status).toBe(200);
    const validJson = await validResponse.json();
    expect(validJson.displayListing.id).toBe("prod-route-test");
    expect(validResponse.headers.get("Cache-Control")).toBe("private, no-cache, no-store, max-age=0, must-revalidate");

    // 2. Missing listing test
    const missingResponse = await getSingleProductApi(new Request("https://localhost/api/public/listings/missing-id"), {
      params: { id: "missing-id" },
    });
    expect(missingResponse.status).toBe(404);
    const missingJson = await missingResponse.json();
    expect(missingJson.message).toBe("Product not found");
  });
});
