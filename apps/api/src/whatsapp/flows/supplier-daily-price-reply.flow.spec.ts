import { describe, expect, it, vi } from "vitest";
import { SupplierDailyPriceReplyFlow } from "./supplier-daily-price-reply.flow";

const BUSINESS_DATE = "2026-10-01";
const SUPPLIER_ID = "supplier-1";
const DEDUPE_KEY = `SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:${SUPPLIER_ID}:${BUSINESS_DATE}`;

function makeHarness(overrides: {
  notificationEvent?: any;
  products?: Array<{ id: string; name: string }>;
  resolveByVerifiedNumber?: any;
} = {}) {
  const prisma = {
    notificationEvent: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.notificationEvent !== undefined
          ? overrides.notificationEvent
          : { id: "evt-1", dedupeKey: DEDUPE_KEY, status: "created" }
      ),
    },
    product: {
      findMany: vi.fn().mockResolvedValue(
        overrides.products ?? [
          { id: "p1", name: "TMT 10mm" },
          { id: "p2", name: "TMT 12mm" },
          { id: "p3", name: "M-Sand" },
        ]
      ),
    },
  };

  const authService = {
    resolveByVerifiedNumber:
      overrides.resolveByVerifiedNumber ??
      vi.fn().mockResolvedValue({
        userId: "user-1",
        supplierProfileId: SUPPLIER_ID,
        email: "supplier@example.com",
        name: "Test Supplier",
        language: "en",
      }),
  };

  const sessionService = {
    withIdempotency: vi.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
  };

  const listingsService = { update: vi.fn().mockResolvedValue({ id: "p1", name: "TMT 10mm", unit: "MT" }) };

  const completeness = {
    getBusinessDateKey: vi.fn().mockReturnValue(BUSINESS_DATE),
    evaluateSupplier: vi.fn().mockResolvedValue({ missingProducts: [] }),
  };

  const dailyPriceReminder = { resolveIfComplete: vi.fn().mockResolvedValue(undefined) };

  const audit = { record: vi.fn().mockResolvedValue(undefined) };

  const flow = new SupplierDailyPriceReplyFlow(
    prisma as any,
    authService as any,
    sessionService as any,
    listingsService as any,
    completeness as any,
    dailyPriceReminder as any,
    audit as any
  );

  return { flow, prisma, authService, sessionService, listingsService, completeness, dailyPriceReminder, audit };
}

describe("SupplierDailyPriceReplyFlow", () => {
  describe("Test 1 — Supplier identity", () => {
    it("resolves a known supplier WhatsApp number and processes the reply", async () => {
      const { flow, authService } = makeHarness();
      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56000", undefined);

      expect(authService.resolveByVerifiedNumber).toHaveBeenCalledWith("919876543210");
      expect(result).not.toBeNull();
    });

    it("an unknown number never applies a price update and responds with null (safe fallthrough)", async () => {
      const { flow, listingsService } = makeHarness({ resolveByVerifiedNumber: vi.fn().mockResolvedValue(null) });

      const result = await flow.tryHandle("919999999999", "TMT 10mm: 56000", undefined);

      expect(result).toBeNull();
      expect(listingsService.update).not.toHaveBeenCalled();
    });
  });

  describe("Test 2 — Active session", () => {
    it("processes the reply when an active (unresolved) session exists", async () => {
      const { flow, completeness } = makeHarness();
      completeness.evaluateSupplier.mockResolvedValue({ missingProducts: [] });

      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56000", undefined);

      expect(result).not.toBeNull();
    });

    it("does not modify any price when there is no active session for today", async () => {
      const { flow, listingsService } = makeHarness({ notificationEvent: null });

      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56000", undefined);

      expect(result).toBeNull();
      expect(listingsService.update).not.toHaveBeenCalled();
    });

    it("does not modify any price when today's session is already resolved (COMPLETED)", async () => {
      const { flow, listingsService } = makeHarness({
        notificationEvent: { id: "evt-1", dedupeKey: DEDUPE_KEY, status: "resolved" },
      });

      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56000", undefined);

      expect(result).toBeNull();
      expect(listingsService.update).not.toHaveBeenCalled();
    });
  });

  describe("Test 3 — Valid full response", () => {
    it("persists all 3 valid prices and marks the session COMPLETED", async () => {
      const { flow, listingsService, dailyPriceReminder, completeness } = makeHarness();
      completeness.evaluateSupplier.mockResolvedValue({ missingProducts: [] });

      const result = await flow.tryHandle(
        "919876543210",
        "TMT 10mm: 56000\nTMT 12mm: 57500\nM-Sand: 2100",
        undefined
      );

      expect(listingsService.update).toHaveBeenCalledTimes(3);
      expect(dailyPriceReminder.resolveIfComplete).toHaveBeenCalledWith(SUPPLIER_ID);
      expect(result).toMatchObject({ kind: "text" });
      expect((result as any).text).toContain("received successfully for all required products");
    });
  });

  describe("Test 4 — Partial response", () => {
    it("persists 2 prices, reports 1 missing, and does not resolve the session", async () => {
      const { flow, listingsService, dailyPriceReminder, completeness } = makeHarness();
      completeness.evaluateSupplier.mockResolvedValue({ missingProducts: [{ id: "p2", name: "TMT 12mm" }] });

      const result = await flow.tryHandle("919876543210", "TMT 10mm: 56000\nM-Sand: 2100", undefined);

      expect(listingsService.update).toHaveBeenCalledTimes(2);
      expect(dailyPriceReminder.resolveIfComplete).not.toHaveBeenCalled();
      expect((result as any).text).toContain("Still required");
      expect((result as any).text).toContain("TMT 12mm");
    });
  });

  describe("Test 5 — Invalid product", () => {
    it("does not persist a product that is not part of the supplier's active listings", async () => {
      const { flow, listingsService, completeness } = makeHarness();
      completeness.evaluateSupplier.mockResolvedValue({
        missingProducts: [
          { id: "p1", name: "TMT 10mm" },
          { id: "p2", name: "TMT 12mm" },
          { id: "p3", name: "M-Sand" },
        ],
      });

      const result = await flow.tryHandle("919876543210", "Unknown Material: 5000", undefined);

      expect(listingsService.update).not.toHaveBeenCalled();
      expect((result as any).text).toContain("Not part of your active listings");
      expect((result as any).text).toContain("Unknown Material");
    });
  });

  describe("Test 6 — Invalid price", () => {
    it("does not persist a non-numeric price", async () => {
      const { flow, listingsService, completeness } = makeHarness();
      completeness.evaluateSupplier.mockResolvedValue({
        missingProducts: [
          { id: "p1", name: "TMT 10mm" },
          { id: "p2", name: "TMT 12mm" },
          { id: "p3", name: "M-Sand" },
        ],
      });

      const result = await flow.tryHandle("919876543210", "TMT 10mm: abc", undefined);

      expect(listingsService.update).not.toHaveBeenCalled();
      expect((result as any).text).toContain("Invalid price");
    });
  });

  describe("Test 7 — Negative/zero price", () => {
    it("does not persist a negative price", async () => {
      const { flow, listingsService, completeness } = makeHarness();
      completeness.evaluateSupplier.mockResolvedValue({
        missingProducts: [
          { id: "p1", name: "TMT 10mm" },
          { id: "p2", name: "TMT 12mm" },
          { id: "p3", name: "M-Sand" },
        ],
      });

      const result = await flow.tryHandle("919876543210", "TMT 10mm: -500", undefined);

      expect(listingsService.update).not.toHaveBeenCalled();
      expect((result as any).text).toContain("Invalid price");
    });

    it("does not persist a zero price", async () => {
      const { flow, listingsService, completeness } = makeHarness();
      completeness.evaluateSupplier.mockResolvedValue({
        missingProducts: [
          { id: "p1", name: "TMT 10mm" },
          { id: "p2", name: "TMT 12mm" },
          { id: "p3", name: "M-Sand" },
        ],
      });

      const result = await flow.tryHandle("919876543210", "TMT 10mm: 0", undefined);

      expect(listingsService.update).not.toHaveBeenCalled();
    });
  });

  describe("Test 8 — Duplicate processing", () => {
    it("applies the same product+price update only once even if the inbound message is processed twice", async () => {
      const idempotencyCache = new Map<string, unknown>();
      const { flow, listingsService, completeness } = makeHarness();
      completeness.evaluateSupplier.mockResolvedValue({ missingProducts: [] });

      (flow as any).sessionService.withIdempotency = vi
        .fn()
        .mockImplementation(async (key: string, fn: () => Promise<unknown>) => {
          if (idempotencyCache.has(key)) return idempotencyCache.get(key);
          const result = await fn();
          idempotencyCache.set(key, result);
          return result;
        });

      await flow.tryHandle("919876543210", "TMT 10mm: 56000", undefined);
      await flow.tryHandle("919876543210", "TMT 10mm: 56000", undefined);

      expect(listingsService.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("Test 9 — Not a daily price reply at all", () => {
    it("returns null (falls through to normal menu handling) for ordinary conversational text", async () => {
      const { flow, authService } = makeHarness();

      const result = await flow.tryHandle("919876543210", "hi there", undefined);

      expect(result).toBeNull();
      expect(authService.resolveByVerifiedNumber).not.toHaveBeenCalled();
    });
  });
});
