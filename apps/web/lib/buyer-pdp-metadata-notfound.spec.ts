import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock next/navigation notFound
const mockNotFound = vi.fn(() => {
  const error = new Error("NEXT_NOT_FOUND");
  (error as any).digest = "NEXT_NOT_FOUND";
  throw error;
});

vi.mock("next/navigation", () => ({
  notFound: () => mockNotFound(),
}));

import { generateMetadata } from "@/app/(builder)/products/[slug]/page";
import * as listingsModule from "./listings";

describe("Buyer PDP generateMetadata and notFound handling", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("Invalid / Missing Product", () => {
    it("invokes notFound() when getSupplierProduct returns null", async () => {
      vi.spyOn(listingsModule, "getSupplierProduct").mockResolvedValue(null);

      await expect(
        generateMetadata({ params: { slug: "uat-invalid-product-404-check" } })
      ).rejects.toThrow("NEXT_NOT_FOUND");

      expect(mockNotFound).toHaveBeenCalledTimes(1);
    });

    it("does not generate misleading metadata or canonical URL for missing products", async () => {
      vi.spyOn(listingsModule, "getSupplierProduct").mockResolvedValue(null);

      let returnedMetadata: any = null;
      try {
        returnedMetadata = await generateMetadata({ params: { slug: "missing-slug" } });
      } catch (e: any) {
        expect(e.digest).toBe("NEXT_NOT_FOUND");
      }

      expect(returnedMetadata).toBeNull();
      expect(mockNotFound).toHaveBeenCalledTimes(1);
    });

    it("supplier scoped endpoint 404 cleanly returns null without full catalogue fallback", async () => {
      const fetchSpy = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/public/listings/missing-product-123")) {
          return Promise.resolve({
            ok: false,
            status: 404,
            headers: { get: () => "application/json" },
            json: () => Promise.resolve({ message: "Product not found" }),
          });
        }
        throw new Error(`Unexpected call to full catalogue: ${url}`);
      });
      global.fetch = fetchSpy as any;

      const group = await listingsModule.getSupplierProductGroup("missing-product-123");
      expect(group).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toContain("/api/public/listings/missing-product-123");
    });
  });

  describe("Valid Product", () => {
    it("generates correct title, description, and canonical URL for valid product", async () => {
      const mockProduct: listingsModule.SupplierListing = {
        id: "prod-101",
        supplierId: "supp-1",
        name: "OPC 53 Grade Cement",
        brand: "UltraTech",
        category: "Cement",
        grade: "53 Grade",
        unit: "BAG",
        price: "₹380 / BAG",
        stock: "500",
        maxServiceableQty: "500",
        active: true,
        pricingTiers: [{ minQty: "1", maxQty: "500", price: "380" }],
      };

      vi.spyOn(listingsModule, "getSupplierProduct").mockResolvedValue(mockProduct);

      const metadata = await generateMetadata({ params: { slug: "prod-101" } });

      expect(mockNotFound).not.toHaveBeenCalled();
      expect(metadata.title).toBe("UltraTech OPC 53 Grade Cement");
      expect(metadata.description).toContain("UltraTech OPC 53 Grade Cement — compare live prices");
      expect(metadata.description).toContain("in Cement on Buildohub.");
      expect((metadata.alternates as any)?.canonical).toContain("/products/prod-101");
    });

    it("avoids duplicating brand prefix if product name already begins with brand", async () => {
      const mockProduct: listingsModule.SupplierListing = {
        id: "prod-102",
        supplierId: "supp-1",
        name: "Tata Tiscon 12mm TMT Bar",
        brand: "Tata Tiscon",
        category: "Steel",
        grade: "Fe 550D",
        unit: "TON",
        price: "₹65,000 / TON",
        stock: "50",
        maxServiceableQty: "50",
        active: true,
        pricingTiers: [{ minQty: "1", maxQty: "50", price: "65000" }],
      };

      vi.spyOn(listingsModule, "getSupplierProduct").mockResolvedValue(mockProduct);

      const metadata = await generateMetadata({ params: { slug: "prod-102" } });

      expect(metadata.title).toBe("Tata Tiscon 12mm TMT Bar");
      expect(metadata.title).not.toMatch(/Tata Tiscon Tata Tiscon/i);
    });
  });

  describe("Deduplication and Cache Tracing", () => {
    it("getSupplierProduct delegates to getSupplierProductGroup and hits scoped endpoint", async () => {
      const mockGroup: listingsModule.ProductGroupResult = {
        displayListing: {
          id: "prod-shared",
          supplierId: "supp-shared",
          name: "Binding Wire",
          category: "Steel",
          grade: "MS",
          unit: "KG",
          price: "₹75 / KG",
          stock: "100",
          maxServiceableQty: "100",
          active: true,
          pricingTiers: [],
        },
        siblings: [],
      };

      const fetchSpy = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/public/listings/prod-shared")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => "application/json" },
            json: () => Promise.resolve(mockGroup),
          });
        }
        throw new Error(`Unexpected call to ${url}`);
      });
      global.fetch = fetchSpy as any;

      const product = await listingsModule.getSupplierProduct("prod-shared");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toContain("/api/public/listings/prod-shared");
      expect(product?.id).toBe("prod-shared");
    });
  });
});
