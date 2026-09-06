import { describe, expect, it, vi } from "vitest";
import { SupplierDailyPriceReminderService } from "./supplier-daily-price-reminder.service";

function makeCompleteness(results: any[]) {
  return { evaluateAllActiveSuppliers: vi.fn().mockResolvedValue(results), evaluateSupplier: vi.fn() };
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
    const prisma = makePrisma({
      userId: "user-1",
      companyName: "Acme Steel",
      user: { whatsappNumber: "919876543210", phone: null },
    });
    const engine = { dispatch: vi.fn().mockResolvedValue({ eventId: "e1", channel: "WHATSAPP", allowed: true }), resolve: vi.fn() };

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
});
