import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks for database and pricing intelligence
const mockWatchlistFindMany = vi.fn();
const mockPricingAlertEvaluationFindMany = vi.fn();
const mockProductFindUnique = vi.fn();
const mockPricingDistrictPriceDailyFindFirst = vi.fn();
const mockGetOrCreateBuilder = vi.fn();
const mockGetWatchlistPriceIntelligence = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    watchlist: {
      findMany: (...args: unknown[]) => mockWatchlistFindMany(...args),
    },
    pricingAlertEvaluation: {
      findMany: (...args: unknown[]) => mockPricingAlertEvaluationFindMany(...args),
    },
    product: {
      findUnique: (...args: unknown[]) => mockProductFindUnique(...args),
    },
    pricingDistrictPriceDaily: {
      findFirst: (...args: unknown[]) => mockPricingDistrictPriceDailyFindFirst(...args),
    },
  },
  getOrCreateBuilder: (...args: unknown[]) => mockGetOrCreateBuilder(...args),
  getUserCtx: (request: Request) => {
    const userId = request.headers.get("X-User-Id");
    const email = request.headers.get("X-User-Email");
    if (!userId || !email) {
      throw new Error("UNAUTHENTICATED");
    }
    return {
      userId,
      email,
      name: request.headers.get("X-User-Name") || "Builder",
    };
  },
}));

vi.mock("@/lib/watchlist-pricing", () => ({
  getWatchlistPriceIntelligence: (...args: unknown[]) => mockGetWatchlistPriceIntelligence(...args),
}));

vi.mock("@/lib/watchlist-alert-copy", () => ({
  suppressionReasonLabel: (reason: string | null) => (reason ? `Suppressed: ${reason}` : null),
}));

import { GET as getWatchlistIds } from "@/app/api/builder/watchlist/ids/route";
import { GET as getFullWatchlist } from "@/app/api/builder/watchlist/route";
import { readFileSync } from "fs";
import path from "path";

function makeRequest(headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/builder/watchlist/ids", {
    headers: headers ?? {
      "X-User-Id": "builder-user-1",
      "X-User-Email": "builder@buildohub.in",
      "X-User-Name": "Test Builder",
    },
  });
}

describe("Work Item 2 — Lightweight Watchlist IDs Endpoint & Provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCreateBuilder.mockResolvedValue({ id: "builder-user-1", email: "builder@buildohub.in" });
  });

  describe("1. GET /api/builder/watchlist/ids", () => {
    it("returns an array of product ID strings for an authenticated builder", async () => {
      mockWatchlistFindMany.mockResolvedValueOnce([
        { productId: "prod_cm71a1b2c" },
        { productId: "prod_cm71a1b2d" },
      ]);

      const req = makeRequest();
      const res = await getWatchlistIds(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(["prod_cm71a1b2c", "prod_cm71a1b2d"]);

      // Verify Prisma query was called with minimal selection scoped to builder
      expect(mockWatchlistFindMany).toHaveBeenCalledTimes(1);
      expect(mockWatchlistFindMany).toHaveBeenCalledWith({
        where: {
          userId: "builder-user-1",
        },
        select: {
          productId: true,
        },
      });
    });

    it("scopes query strictly to the authenticated user ID (data isolation)", async () => {
      mockGetOrCreateBuilder.mockResolvedValueOnce({ id: "isolated-builder-42", email: "builder42@example.com" });
      mockWatchlistFindMany.mockResolvedValueOnce([{ productId: "prod_999" }]);

      const req = makeRequest({
        "X-User-Id": "isolated-builder-42",
        "X-User-Email": "builder42@example.com",
      });
      const res = await getWatchlistIds(req);

      expect(res.status).toBe(200);
      expect(mockWatchlistFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: "isolated-builder-42",
          },
        })
      );
    });

    it("returns HTTP 200 with an empty array when the user has no watchlist items", async () => {
      mockWatchlistFindMany.mockResolvedValueOnce([]);

      const req = makeRequest();
      const res = await getWatchlistIds(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
      expect(Array.isArray(data)).toBe(true);
    });

    it("rejects unauthenticated requests with HTTP 401", async () => {
      // Empty headers simulate an unauthenticated caller bypassing middleware
      const req = new Request("http://localhost/api/builder/watchlist/ids", { headers: {} });
      const res = await getWatchlistIds(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toEqual({ error: "Unauthorized" });
      expect(mockWatchlistFindMany).not.toHaveBeenCalled();
    });

    it("handles database errors gracefully with HTTP 500 without leaking stack traces", async () => {
      mockWatchlistFindMany.mockRejectedValueOnce(new Error("Database connection pool exhausted"));

      const req = makeRequest();
      const res = await getWatchlistIds(req);

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ error: "Failed to fetch watchlist IDs" });
    });

    it("CRITICAL: does NOT execute product enrichment, price intelligence, or alert evaluations", async () => {
      mockWatchlistFindMany.mockResolvedValueOnce([
        { productId: "prod_1" },
        { productId: "prod_2" },
      ]);

      const req = makeRequest();
      await getWatchlistIds(req);

      // Verify none of the heavy pricing or alert enrichment functions were invoked
      expect(mockGetWatchlistPriceIntelligence).not.toHaveBeenCalled();
      expect(mockPricingAlertEvaluationFindMany).not.toHaveBeenCalled();
      expect(mockProductFindUnique).not.toHaveBeenCalled();
      expect(mockPricingDistrictPriceDailyFindFirst).not.toHaveBeenCalled();

      // Verify the query does NOT include { product: true }
      expect(mockWatchlistFindMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.anything(),
        })
      );
    });
  });

  describe("2. Full Watchlist Regression Contract (GET /api/builder/watchlist)", () => {
    it("preserves the existing full enriched response contract for dedicated screens", async () => {
      mockWatchlistFindMany.mockResolvedValueOnce([
        {
          id: "wl_item_1",
          productId: "prod_1",
          targetPrice: 450,
          alertSent: false,
          product: {
            name: "Ordinary Portland Cement 53 Grade",
            unit: "bag",
            basePrice: 420,
          },
        },
      ]);

      mockGetWatchlistPriceIntelligence.mockResolvedValueOnce({
        resolved: true,
        emptyReason: null,
        districtName: "Bangalore",
        currentPricePerBaseUnit: 410,
        gapToTarget: -40,
        gapToTargetPct: -8.88,
      });

      mockPricingAlertEvaluationFindMany.mockResolvedValueOnce([
        {
          evaluatedAt: new Date("2026-11-01T00:00:00Z"),
          didTrigger: true,
          suppressedReason: null,
        },
      ]);

      const req = makeRequest();
      const res = await getFullWatchlist(req);

      expect(res.status).toBe(200);
      const data = await res.json();

      // Asserts that full endpoint returns complete enriched object
      expect(data).toHaveLength(1);
      expect(data[0]).toEqual({
        id: "wl_item_1",
        productId: "prod_1",
        name: "Ordinary Portland Cement 53 Grade",
        unit: "bag",
        basePrice: 420,
        targetPrice: 450,
        alertSent: false,
        priceIntelligence: expect.objectContaining({
          resolved: true,
          currentPricePerBaseUnit: 410,
        }),
        recentEvaluations: [
          {
            evaluatedAt: "2026-11-01T00:00:00.000Z",
            didTrigger: true,
            suppressedReason: null,
            suppressedReasonLabel: null,
          },
        ],
      });

      // Confirm full endpoint invoked price intelligence and alert evaluation
      expect(mockGetWatchlistPriceIntelligence).toHaveBeenCalledTimes(1);
      expect(mockPricingAlertEvaluationFindMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("3. WatchlistProvider Source Invariants & Regression Guard", () => {
    const storeSource = readFileSync(
      path.resolve(__dirname, "watchlist-store.tsx"),
      "utf-8"
    );
    const watchlistPageSource = readFileSync(
      path.resolve(__dirname, "../app/(builder)/watchlist/page.tsx"),
      "utf-8"
    );
    const newdashPageSource = readFileSync(
      path.resolve(__dirname, "../app/(newdash)/newdashboard/page.tsx"),
      "utf-8"
    );

    it("WatchlistProvider calls the lightweight /watchlist/ids endpoint", () => {
      expect(storeSource).toMatch(/builderApiGet<string\[\]>\("\/watchlist\/ids"\)/);
    });

    it("WatchlistProvider populates watchedIds Set directly from productIds", () => {
      expect(storeSource).toMatch(/setWatchedIds\(new Set\(productIds\)\)/);
    });

    it("WatchlistProvider no longer invokes the full /watchlist endpoint on mount", () => {
      expect(storeSource).not.toMatch(/builderApiGet<Array<\{ productId: string \}>>\("\/watchlist"\)/);
    });

    it("WatchlistProvider preserves all public interface methods", () => {
      expect(storeSource).toMatch(/isWatched:/);
      expect(storeSource).toMatch(/isPending:/);
      expect(storeSource).toMatch(/add,/);
      expect(storeSource).toMatch(/remove,/);
      expect(storeSource).toMatch(/toggle,/);
      expect(storeSource).toMatch(/status,/);
      expect(storeSource).toMatch(/isAuthenticated,/);
    });

    it("Dedicated Watchlist page continues using the full enriched /watchlist endpoint", () => {
      expect(watchlistPageSource).toMatch(/builderApiGet<WatchlistItem\[\]>\("\/watchlist"\)/);
    });

    it("New Dashboard continues using the full enriched /watchlist endpoint", () => {
      expect(newdashPageSource).toMatch(/builderApiGet<WatchlistItem\[\]>\("\/watchlist"\)/);
    });
  });
});
