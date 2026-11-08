import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

import { getSupplierListings, getSupplierProductGroup, getSupplierProduct } from "./listings";
import { POST as revalidateRoute } from "@/app/api/revalidate/route";
import { revalidateTag, revalidatePath } from "next/cache";
import crypto from "node:crypto";

function timingSafeSecretMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const hashA = crypto.createHash("sha256").update(a, "utf8").digest();
  const hashB = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

describe("Listings Data Cache & Single Product Retrieval (Phase 1)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("getSupplierListings configures Next.js Data Cache with 300s TTL and catalog-listings tag", async () => {
    const mockListings = [
      {
        id: "p1",
        name: "Cement 50kg",
        category: "Cement",
        price: "₹400 / BAG",
        unit: "BAG",
        stock: "100",
        active: true,
      },
    ];

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h: string) => (h === "content-type" ? "application/json" : null),
      },
      json: () => Promise.resolve(mockListings),
    });
    global.fetch = fetchSpy as any;

    const result = await getSupplierListings();
    expect(result).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalled();

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/public/listings");
    expect(options?.next?.revalidate).toBe(300);
    expect(options?.next?.tags).toContain("catalog-listings");
  });

  it("getSupplierProductGroup queries dedicated single product endpoint with product tag", async () => {
    const mockGroup = {
      displayListing: {
        id: "p-slug-1",
        name: "Tata Tiscon 12mm",
        category: "Steel",
        price: "₹72 / KG",
        unit: "KG",
        active: true,
        images: ["https://example.com/photo.jpg"],
      },
      siblings: [],
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h: string) => (h === "content-type" ? "application/json" : null),
      },
      json: () => Promise.resolve(mockGroup),
    });
    global.fetch = fetchSpy as any;

    const result = await getSupplierProductGroup("p-slug-1");
    expect(result).not.toBeNull();
    expect(result!.displayListing.id).toBe("p-slug-1");

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/public/listings/p-slug-1");
    expect(options?.next?.revalidate).toBe(300);
    expect(options?.next?.tags).toContain("product-p-slug-1");
  });

  it("getSupplierProduct returns displayListing from the product group", async () => {
    const mockGroup = {
      displayListing: {
        id: "p-test-2",
        name: "Ultratech Cement",
        price: "₹450 / BAG",
      },
      siblings: [],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h: string) => (h === "content-type" ? "application/json" : null),
      },
      json: () => Promise.resolve(mockGroup),
    }) as any;

    const product = await getSupplierProduct("p-test-2");
    expect(product).not.toBeNull();
    expect(product?.name).toBe("Ultratech Cement");
  });

  it("getSupplierProductGroup returns null immediately on 404 and does NOT fetch all listings", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/public/listings/non-existent-slug")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: { get: () => "application/json" },
          json: () => Promise.resolve({ message: "Product not found" }),
        });
      }
      // If all-listings endpoint is called, that is an error for 404!
      throw new Error(`Unexpected call to ${url}`);
    });
    global.fetch = fetchSpy as any;

    const result = await getSupplierProductGroup("non-existent-slug");
    expect(result).toBeNull();
    // Verify only the single product endpoint was hit exactly once
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain("/api/public/listings/non-existent-slug");
  });

  it("getSupplierProductGroup on 200 does NOT fetch all listings", async () => {
    const mockGroup = {
      displayListing: {
        id: "p-valid-slug",
        name: "Jindal Steel 10mm",
        price: "₹70 / KG",
      },
      siblings: [],
    };

    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/public/listings/p-valid-slug")) {
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

    const result = await getSupplierProductGroup("p-valid-slug");
    expect(result).not.toBeNull();
    expect(result?.displayListing.id).toBe("p-valid-slug");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("getSupplierProductGroup on 500 server error falls back to cached all-listings", async () => {
    const mockAllListings = [
      {
        id: "p-500-fallback",
        name: "Fallback Cement",
        price: "₹380 / BAG",
        active: true,
      },
    ];

    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/public/listings/p-500-fallback")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: { get: () => "application/json" },
          json: () => Promise.resolve({ message: "Internal server error" }),
        });
      }
      if (url.endsWith("/api/public/listings")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          json: () => Promise.resolve(mockAllListings),
        });
      }
      throw new Error(`Unexpected call to ${url}`);
    });
    global.fetch = fetchSpy as any;

    const result = await getSupplierProductGroup("p-500-fallback");
    expect(result).not.toBeNull();
    expect(result?.displayListing.id).toBe("p-500-fallback");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/revalidate — Secure On-Demand Invalidation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, INTERNAL_REVALIDATION_SECRET: "test-secret-12345" };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 500 when INTERNAL_REVALIDATION_SECRET is not configured on the server", async () => {
    delete process.env.INTERNAL_REVALIDATION_SECRET;
    const req = new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": "any-token",
      },
      body: JSON.stringify({ tag: "catalog-listings" }),
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.message).toContain("INTERNAL_REVALIDATION_SECRET is not configured");
  });

  it("returns 401 when request is missing authentication token", async () => {
    const req = new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "catalog-listings" }),
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("returns 401 when token is incorrect", async () => {
    const req = new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": "wrong-secret",
      },
      body: JSON.stringify({ tag: "catalog-listings" }),
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("automatically invalidates /products path when catalog-listings tag is invalidated", async () => {
    const req = new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": "test-secret-12345",
      },
      body: JSON.stringify({
        tags: ["catalog-listings"],
      }),
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.revalidated).toBe(true);

    expect(revalidateTag).toHaveBeenCalledWith("catalog-listings");
    expect(revalidatePath).toHaveBeenCalledWith("/products");
  });

  it("revalidates requested tags and paths when authorized", async () => {
    const req = new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": "test-secret-12345",
      },
      body: JSON.stringify({
        tags: ["catalog-listings", "product-123"],
        paths: ["/products", "/products/123"],
      }),
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.revalidated).toBe(true);

    expect(revalidateTag).toHaveBeenCalledWith("catalog-listings");
    expect(revalidateTag).toHaveBeenCalledWith("product-123");
    expect(revalidatePath).toHaveBeenCalledWith("/products");
    expect(revalidatePath).toHaveBeenCalledWith("/products/123");
  });

  it("never exposes secret token in error responses or logs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const secretValue = "super-secret-revalidation-token-abc";
    process.env.INTERNAL_REVALIDATION_SECRET = secretValue;

    const req = new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": "wrong-token",
      },
      body: JSON.stringify({ tags: ["catalog-listings"] }),
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(401);
    const bodyText = JSON.stringify(await res.json());
    expect(bodyText).not.toContain(secretValue);

    for (const call of errorSpy.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain(secretValue);
      }
    }
    errorSpy.mockRestore();
  });

  it("rejects unauthorized requests before body validation or invalidation", async () => {
    const req = new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["malformed-arbitrary-tag!"] }),
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects arbitrary tags and performs zero invalidations", async () => {
    const req = new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": "test-secret-12345",
      },
      body: JSON.stringify({
        tags: ["users", "orders", "cart-items"],
      }),
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toContain("Disallowed or malformed tag");
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects arbitrary paths outside catalogue and performs zero invalidations", async () => {
    const forbiddenPaths = [
      "/",
      "/admin",
      "/checkout",
      "/cart",
      "/orders/123",
      "/api/revalidate",
      "/api/builder/cart",
      "/auth/login",
    ];

    for (const badPath of forbiddenPaths) {
      vi.clearAllMocks();
      const req = new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-revalidate-secret": "test-secret-12345",
        },
        body: JSON.stringify({
          paths: [badPath],
        }),
      });

      const res = await revalidateRoute(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain("Disallowed or malformed path");
      expect(revalidateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  });

  it("rejects path traversal attempts with 400 and performs zero invalidations", async () => {
    const traversalPaths = [
      "/products/../admin",
      "/products/../../etc/passwd",
      "/products/..",
    ];

    for (const badPath of traversalPaths) {
      vi.clearAllMocks();
      const req = new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-revalidate-secret": "test-secret-12345",
        },
        body: JSON.stringify({
          paths: [badPath],
        }),
      });

      const res = await revalidateRoute(req);
      expect(res.status).toBe(400);
      expect(revalidateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  });

  it("rejects query strings and fragments in paths with 400", async () => {
    const queryPaths = [
      "/products?category=cement",
      "/products#details",
      "/products/123?foo=bar",
    ];

    for (const badPath of queryPaths) {
      vi.clearAllMocks();
      const req = new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-revalidate-secret": "test-secret-12345",
        },
        body: JSON.stringify({
          paths: [badPath],
        }),
      });

      const res = await revalidateRoute(req);
      expect(res.status).toBe(400);
      expect(revalidateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  });

  it("rejects non-string tags or paths with 400", async () => {
    const invalidBodies = [
      { tags: [123] },
      { tags: [{ name: "catalog-listings" }] },
      { paths: [true] },
      { paths: [{ path: "/products" }] },
      { tag: 456 },
      { path: null },
    ];

    for (const badBody of invalidBodies) {
      vi.clearAllMocks();
      const req = new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-revalidate-secret": "test-secret-12345",
        },
        body: JSON.stringify(badBody),
      });

      const res = await revalidateRoute(req);
      expect(res.status).toBe(400);
      expect(revalidateTag).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  });

  it("rejects excessively large arrays with 400", async () => {
    const hugeTags = Array.from({ length: 51 }, (_, i) => `product-p${i}`);
    const req = new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": "test-secret-12345",
      },
      body: JSON.stringify({ tags: hugeTags }),
    });

    const res = await revalidateRoute(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toContain("Too many tags or paths specified");
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("timingSafeSecretMatch — Constant-Time Digest Comparison", () => {
  it("returns true for matching secrets", () => {
    expect(timingSafeSecretMatch("my-secret-token", "my-secret-token")).toBe(true);
    expect(timingSafeSecretMatch("a", "a")).toBe(true);
    expect(timingSafeSecretMatch("very-long-token-1234567890abcdef", "very-long-token-1234567890abcdef")).toBe(true);
  });

  it("returns false for different secrets of equal length", () => {
    expect(timingSafeSecretMatch("token-1234", "token-5678")).toBe(false);
    expect(timingSafeSecretMatch("a", "b")).toBe(false);
  });

  it("returns false for different secrets of unequal length", () => {
    expect(timingSafeSecretMatch("short", "much-longer-secret-token")).toBe(false);
    expect(timingSafeSecretMatch("much-longer-secret-token", "short")).toBe(false);
    expect(timingSafeSecretMatch("token", "token-extra")).toBe(false);
  });

  it("handles empty strings safely without throwing", () => {
    expect(timingSafeSecretMatch("", "")).toBe(true);
    expect(timingSafeSecretMatch("", "non-empty")).toBe(false);
    expect(timingSafeSecretMatch("non-empty", "")).toBe(false);
  });

  it("returns false when inputs are not strings", () => {
    expect(timingSafeSecretMatch(null as any, "secret")).toBe(false);
    expect(timingSafeSecretMatch("secret", undefined as any)).toBe(false);
    expect(timingSafeSecretMatch(1234 as any, "1234")).toBe(false);
  });
});

