import { describe, expect, it, vi } from "vitest";
import { SupplierDailyPriceReminderService } from "./supplier-daily-price-reminder.service";

function makeCompleteness(results: any[]) {
  return { evaluateAllActiveSuppliers: vi.fn().mockResolvedValue(results), evaluateSupplier: vi.fn() };
}

function makeSupplierProfile(overrides: Record<string, any> = {}) {
  return {
    userId: "user-1",
    companyName: "Acme Steel",
    user: { whatsappNumber: "919876543210", phone: null },
    ...overrides,
  };
}

function makePrisma(supplierProfile: any) {
  return { supplierProfile: { findUnique: vi.fn().mockResolvedValue(supplierProfile) } };
}

describe("SupplierDailyPriceReminderService", () => {
  it("does not notify a supplier whose price list is already complete", async () => {
    const completeness = makeCompleteness([{ supplierId: "s1", businessDate: "2026-01-01", missingProducts: [], totalRequired: 2, totalUpdatedToday: 2 }]);
    const prisma = makePrisma(null);
    const engine = { dispatch: vi.fn(), resolve: vi.fn() };

    const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
    const result = await service.evaluateAndNotify();

    expect(engine.dispatch).not.toHaveBeenCalled();
    expect(result.skippedComplete).toBe(1);
    expect(result.notified).toBe(0);
  });

  it("notifies with a deterministic dedupe key when products are missing", async () => {
    const completeness = makeCompleteness([
      { supplierId: "s1", businessDate: "2026-01-01", missingProducts: [{ id: "p1", name: "TMT 10mm" }], totalRequired: 1, totalUpdatedToday: 0 },
    ]);
    const prisma = makePrisma(makeSupplierProfile());
    const engine = {
      dispatch: vi.fn().mockResolvedValue({ eventId: "e1", channel: "WHATSAPP", allowed: true, sendResult: { success: true, externalId: "wamid.1" } }),
      resolve: vi.fn(),
    };

    const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
    const result = await service.evaluateAndNotify();

    expect(engine.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED",
        recipientId: "user-1",
        dedupeKey: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:s1:2026-01-01",
      }),
      "WHATSAPP"
    );
    expect(result.notified).toBe(1);
  });

  describe("Test 1 — Supplier with multiple missing prices", () => {
    it("passes exactly ONE body parameter containing the full comma-separated missing-product list", async () => {
      const completeness = makeCompleteness([
        {
          supplierId: "s1",
          businessDate: "2026-01-01",
          missingProducts: [
            { id: "p1", name: "TMT 10mm" },
            { id: "p2", name: "TMT 12mm" },
            { id: "p3", name: "M-Sand" },
          ],
          totalRequired: 3,
          totalUpdatedToday: 0,
        },
      ]);
      const prisma = makePrisma(makeSupplierProfile());
      const engine = {
        dispatch: vi.fn().mockResolvedValue({ eventId: "e1", channel: "WHATSAPP", allowed: true, sendResult: { success: true, externalId: "wamid.1" } }),
        resolve: vi.fn(),
      };

      const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
      await service.evaluateAndNotify();

      expect(engine.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ parameters: ["TMT 10mm, TMT 12mm, M-Sand"] }),
        "WHATSAPP"
      );
    });
  });

  describe("Test 2 — One missing product", () => {
    it("the single body parameter contains just that one product name", async () => {
      const completeness = makeCompleteness([
        { supplierId: "s1", businessDate: "2026-01-01", missingProducts: [{ id: "p1", name: "TMT 10mm" }], totalRequired: 1, totalUpdatedToday: 0 },
      ]);
      const prisma = makePrisma(makeSupplierProfile());
      const engine = {
        dispatch: vi.fn().mockResolvedValue({ eventId: "e1", channel: "WHATSAPP", allowed: true, sendResult: { success: true, externalId: "wamid.1" } }),
        resolve: vi.fn(),
      };

      const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
      await service.evaluateAndNotify();

      expect(engine.dispatch).toHaveBeenCalledWith(expect.objectContaining({ parameters: ["TMT 10mm"] }), "WHATSAPP");
    });
  });

  describe("Test 3 — No missing products", () => {
    it("never dispatches when missingProducts is empty", async () => {
      const completeness = makeCompleteness([{ supplierId: "s1", businessDate: "2026-01-01", missingProducts: [], totalRequired: 2, totalUpdatedToday: 2 }]);
      const prisma = makePrisma(null);
      const engine = { dispatch: vi.fn(), resolve: vi.fn() };

      const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
      const result = await service.evaluateAndNotify();

      expect(engine.dispatch).not.toHaveBeenCalled();
      expect(result.notified).toBe(0);
    });
  });

  it("resolveIfComplete marks the day's reminder resolved once the supplier's list becomes fully complete", async () => {
    const completeness = { evaluateSupplier: vi.fn().mockResolvedValue({ supplierId: "s1", businessDate: "2026-01-01", missingProducts: [], totalRequired: 1, totalUpdatedToday: 1 }), evaluateAllActiveSuppliers: vi.fn() };
    const prisma = makePrisma(null);
    const engine = { dispatch: vi.fn(), resolve: vi.fn().mockResolvedValue(undefined) };

    const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
    await service.resolveIfComplete("s1");

    expect(engine.resolve).toHaveBeenCalledWith("SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:s1:2026-01-01");
  });

  it("resolveIfComplete does nothing while products are still missing", async () => {
    const completeness = { evaluateSupplier: vi.fn().mockResolvedValue({ supplierId: "s1", businessDate: "2026-01-01", missingProducts: [{ id: "p1", name: "TMT 10mm" }], totalRequired: 1, totalUpdatedToday: 0 }), evaluateAllActiveSuppliers: vi.fn() };
    const prisma = makePrisma(null);
    const engine = { dispatch: vi.fn(), resolve: vi.fn() };

    const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
    await service.resolveIfComplete("s1");

    expect(engine.resolve).not.toHaveBeenCalled();
  });

  describe("Test 4 — Multiple suppliers, mixed completeness", () => {
    it("only notifies suppliers with at least one missing product", async () => {
      const completeness = makeCompleteness([
        { supplierId: "sA", businessDate: "2026-01-01", missingProducts: [{ id: "p1", name: "TMT 10mm" }, { id: "p2", name: "TMT 12mm" }, { id: "p3", name: "M-Sand" }], totalRequired: 3, totalUpdatedToday: 0 },
        { supplierId: "sB", businessDate: "2026-01-01", missingProducts: [], totalRequired: 2, totalUpdatedToday: 2 },
        { supplierId: "sC", businessDate: "2026-01-01", missingProducts: [{ id: "p4", name: "Cement OPC" }], totalRequired: 1, totalUpdatedToday: 0 },
      ]);
      const prisma = {
        supplierProfile: {
          findUnique: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(makeSupplierProfile({ userId: `user-${where.id}` }))),
        },
      };
      const engine = {
        dispatch: vi.fn().mockResolvedValue({ eventId: "e1", channel: "WHATSAPP", allowed: true, sendResult: { success: true, externalId: "wamid.1" } }),
        resolve: vi.fn(),
      };

      const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
      const result = await service.evaluateAndNotify();

      expect(engine.dispatch).toHaveBeenCalledTimes(2);
      expect(engine.dispatch).toHaveBeenCalledWith(expect.objectContaining({ entityId: "sA" }), "WHATSAPP");
      expect(engine.dispatch).toHaveBeenCalledWith(expect.objectContaining({ entityId: "sC" }), "WHATSAPP");
      expect(engine.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ entityId: "sB" }), "WHATSAPP");
      expect(result.notified).toBe(2);
      expect(result.skippedComplete).toBe(1);
    });
  });

  describe("Test 5 — Duplicate scheduler execution", () => {
    it("the second run for the same supplier/business date is suppressed by the Notification Engine's dedupe (no second Meta call)", async () => {
      const completeness = makeCompleteness([
        { supplierId: "s1", businessDate: "2026-01-01", missingProducts: [{ id: "p1", name: "TMT 10mm" }], totalRequired: 1, totalUpdatedToday: 0 },
      ]);
      const prisma = makePrisma(makeSupplierProfile());
      const engine = {
        dispatch: vi
          .fn()
          .mockResolvedValueOnce({ eventId: "e1", channel: "WHATSAPP", allowed: true, sendResult: { success: true, externalId: "wamid.1" } })
          .mockResolvedValueOnce({ eventId: "e2", channel: "WHATSAPP", allowed: false, reason: "DUPLICATE_DEDUPE_KEY" }),
        resolve: vi.fn(),
      };

      const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
      const first = await service.evaluateAndNotify();
      const second = await service.evaluateAndNotify();

      expect(engine.dispatch).toHaveBeenCalledTimes(2);
      expect(first.notified).toBe(1);
      expect(second.notified).toBe(0);
    });
  });

  describe("Test 6 — Correct template dispatch shape", () => {
    it("dispatches with the SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED event type and exactly one parameter", async () => {
      const completeness = makeCompleteness([
        { supplierId: "s1", businessDate: "2026-01-01", missingProducts: [{ id: "p1", name: "TMT 10mm" }], totalRequired: 1, totalUpdatedToday: 0 },
      ]);
      const prisma = makePrisma(makeSupplierProfile());
      const engine = {
        dispatch: vi.fn().mockResolvedValue({ eventId: "e1", channel: "WHATSAPP", allowed: true, sendResult: { success: true, externalId: "wamid.1" } }),
        resolve: vi.fn(),
      };

      const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
      await service.evaluateAndNotify();

      const [payload, channel] = engine.dispatch.mock.calls[0];
      expect(payload.eventType).toBe("SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED");
      expect(channel).toBe("WHATSAPP");
      expect(payload.parameters).toHaveLength(1);
    });
  });

  describe("Test 7 — Notification policy suppression", () => {
    it("never treats a policy-suppressed dispatch as notified", async () => {
      const completeness = makeCompleteness([
        { supplierId: "s1", businessDate: "2026-01-01", missingProducts: [{ id: "p1", name: "TMT 10mm" }], totalRequired: 1, totalUpdatedToday: 0 },
      ]);
      const prisma = makePrisma(makeSupplierProfile());
      const engine = { dispatch: vi.fn().mockResolvedValue({ eventId: "e1", channel: "WHATSAPP", allowed: false, reason: "CHANNEL_DISABLED_GLOBALLY" }), resolve: vi.fn() };

      const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
      const result = await service.evaluateAndNotify();

      expect(result.notified).toBe(0);
    });
  });

  describe("Test 8 — Missing phone", () => {
    it("still dispatches with phone: null without crashing — the WhatsApp channel itself safely no-ops on a missing phone", async () => {
      const completeness = makeCompleteness([
        { supplierId: "s1", businessDate: "2026-01-01", missingProducts: [{ id: "p1", name: "TMT 10mm" }], totalRequired: 1, totalUpdatedToday: 0 },
      ]);
      const prisma = makePrisma(makeSupplierProfile({ user: { whatsappNumber: null, phone: null } }));
      const engine = {
        dispatch: vi.fn().mockResolvedValue({ eventId: "e1", channel: "WHATSAPP", allowed: true, sendResult: { success: false, error: "NO_PHONE_NUMBER" } }),
        resolve: vi.fn(),
      };

      const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
      await expect(service.evaluateAndNotify()).resolves.toBeDefined();

      expect(engine.dispatch).toHaveBeenCalledWith(expect.objectContaining({ phone: null }), "WHATSAPP");
    });
  });

  describe("Test 9 — Meta send failure does not crash the batch", () => {
    it("completes evaluateAndNotify without throwing even when the underlying Meta send fails", async () => {
      const completeness = makeCompleteness([
        { supplierId: "s1", businessDate: "2026-01-01", missingProducts: [{ id: "p1", name: "TMT 10mm" }], totalRequired: 1, totalUpdatedToday: 0 },
      ]);
      const prisma = makePrisma(makeSupplierProfile());
      const engine = {
        dispatch: vi.fn().mockResolvedValue({ eventId: "e1", channel: "WHATSAPP", allowed: true, sendResult: { success: false, error: "Meta Cloud API error (HTTP 500)" } }),
        resolve: vi.fn(),
      };

      const service = new SupplierDailyPriceReminderService(prisma as any, completeness as any, engine as any);
      const result = await service.evaluateAndNotify();

      expect(result.notified).toBe(1);
      expect(result.evaluated).toBe(1);
    });
  });
});
