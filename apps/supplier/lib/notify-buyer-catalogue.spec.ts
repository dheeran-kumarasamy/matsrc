import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notifyBuyerCatalogueUpdated } from "./supplier-data";

describe("notifyBuyerCatalogueUpdated (Cross-App Invalidation Webhook)", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      INTERNAL_REVALIDATION_SECRET: "test-reval-secret-xyz",
      BUILDER_APP_URL: "https://buildohub.in",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it("skips fetch and logs warning when INTERNAL_REVALIDATION_SECRET is missing", async () => {
    delete process.env.INTERNAL_REVALIDATION_SECRET;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    await notifyBuyerCatalogueUpdated();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("INTERNAL_REVALIDATION_SECRET is not configured")
    );
  });

  it("dispatches revalidation webhook with default tags and paths on 200 OK", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchSpy as any;

    await notifyBuyerCatalogueUpdated();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://buildohub.in/api/revalidate");
    expect(options.method).toBe("POST");
    expect(options.headers["x-revalidate-secret"]).toBe("test-reval-secret-xyz");

    const body = JSON.parse(options.body);
    expect(body.tags).toEqual(["catalog-listings"]);
    expect(body.paths).toEqual(["/products"]);
  });

  it("dispatches targeted tags and paths when specified", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchSpy as any;

    await notifyBuyerCatalogueUpdated({
      tags: ["catalog-listings", "product-prod-123"],
      paths: ["/products", "/products/prod-123"],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.tags).toEqual(["catalog-listings", "product-prod-123"]);
    expect(body.paths).toEqual(["/products", "/products/prod-123"]);
  });

  it("logs warning on 401 Unauthorized without throwing or blocking", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    }) as any;

    await expect(notifyBuyerCatalogueUpdated()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Buyer revalidation returned HTTP 401")
    );
  });

  it("logs warning on 404 Not Found without throwing or blocking", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Endpoint not found"),
    }) as any;

    await expect(notifyBuyerCatalogueUpdated()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Buyer revalidation returned HTTP 404")
    );
  });

  it("logs warning on 500 Internal Server Error without throwing or blocking", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal error"),
    }) as any;

    await expect(notifyBuyerCatalogueUpdated()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Buyer revalidation returned HTTP 500")
    );
  });

  it("logs warning on network timeout without throwing or blocking", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const timeoutErr = new Error("The operation was aborted due to timeout");
    timeoutErr.name = "TimeoutError";
    global.fetch = vi.fn().mockRejectedValue(timeoutErr) as any;

    await expect(notifyBuyerCatalogueUpdated()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Buyer revalidation request timed out")
    );
  });

  it("logs warning on connection failure without throwing or blocking", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

    await expect(notifyBuyerCatalogueUpdated()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Buyer revalidation request failed:"),
      expect.stringContaining("ECONNREFUSED")
    );
  });
});
