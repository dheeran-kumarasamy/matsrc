import { describe, it, expect, vi, beforeEach } from "vitest";

const { productRows, mockEnsureSupplierContext } = vi.hoisted(() => {
  return {
    productRows: [] as any[],
    mockEnsureSupplierContext: vi.fn(),
  };
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
        findMany: vi.fn(() => Promise.resolve([])),
      },
    },
    notifyCustomerOrderStatusChanged: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("./twilio-whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));

import {
  getPublicSupplierListings,
  getPublicSupplierProductById,
  getSupplierListings,
} from "./supplier-data";

function makeProductWithImages(overrides: Partial<any> & { id: string; images: string[] }) {
  return {
    id: overrides.id,
    supplierId: overrides.supplierId ?? "sup-1",
    categoryId: overrides.categoryId ?? "cat-1",
    canonicalProductId: overrides.canonicalProductId ?? null,
    name: overrides.name ?? "UltraTech Cement 50kg",
    category: { name: "Cement" },
    brandRef: null,
    brand: "UltraTech",
    grade: "OPC53",
    unit: "BAG",
    basePrice: overrides.basePrice ?? 450,
    stock: 500,
    maxServiceableQty: 500,
    isActive: true,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    images: overrides.images,
    pricingTiers: overrides.pricingTiers ?? [{ minQty: 1, maxQty: 500, tierPrice: 450 }],
  };
}

beforeEach(() => {
  productRows.length = 0;
});

describe("Public catalogue image optimization (Phase 1)", () => {
  it("replaces large base64 data URIs with lightweight fallback URLs for catalogue browsing", async () => {
    const hugeBase64 = "data:image/jpeg;base64," + "A".repeat(10000);
    productRows.push(
      makeProductWithImages({
        id: "prod-base64",
        images: [hugeBase64],
      })
    );

    const listings = await getPublicSupplierListings();
    expect(listings).toHaveLength(1);

    const images = listings[0].images;
    expect(images).toBeDefined();
    expect(images.length).toBeGreaterThan(0);
    // The image must NOT contain the huge base64 data URI
    expect(images[0]).not.toContain("data:image/jpeg;base64,");
    // It should be a lightweight external URL (e.g. Unsplash brand/category match)
    expect(images[0]).toMatch(/^https?:\/\//);
  });

  it("preserves external HTTPS image URLs without alteration", async () => {
    const externalUrl = "https://images.unsplash.com/photo-example-123";
    productRows.push(
      makeProductWithImages({
        id: "prod-external",
        images: [externalUrl],
      })
    );

    const listings = await getPublicSupplierListings();
    expect(listings[0].images).toEqual([externalUrl]);
  });

  it("getPublicSupplierProductById preserves full original images for PDP detail rendering", async () => {
    const hugeBase64 = "data:image/jpeg;base64," + "B".repeat(5000);
    productRows.push(
      makeProductWithImages({
        id: "prod-detail",
        images: [hugeBase64],
      })
    );

    const result = await getPublicSupplierProductById("prod-detail");
    expect(result).not.toBeNull();
    expect(result!.displayListing.id).toBe("prod-detail");
    // Detail view MUST preserve the supplier's actual uploaded image intact
    expect(result!.displayListing.images).toEqual([hugeBase64]);
  });

  it("never returns known 404 Unsplash URLs for pipes, aggregate, or brick products", async () => {
    productRows.push(
      makeProductWithImages({
        id: "prod-pipe",
        name: "Supreme PVC Pipe 4 inch",
        category: { name: "Pipes & Fittings" },
        brand: "Supreme",
        images: ["data:image/jpeg;base64,AAAA"],
      }),
      makeProductWithImages({
        id: "prod-agg",
        name: "Blue Metal Aggregate 20mm",
        category: { name: "Aggregate" },
        brand: null,
        images: ["data:image/jpeg;base64,BBBB"],
      }),
      makeProductWithImages({
        id: "prod-brick",
        name: "Red Clay Wire Cut Bricks",
        category: { name: "Bricks" },
        brand: null,
        images: ["data:image/jpeg;base64,CCCC"],
      })
    );

    const listings = await getPublicSupplierListings();
    const forbidden = [
      "photo-1621905252472-e8de3d47fea8",
      "photo-1610500795312-4a5b6b2b6e2f",
      "photo-1567605532317-c8a3b1c25f5a",
    ];

    for (const listing of listings) {
      for (const img of listing.images) {
        for (const bad of forbidden) {
          expect(img).not.toContain(bad);
        }
      }
    }
  });
});

