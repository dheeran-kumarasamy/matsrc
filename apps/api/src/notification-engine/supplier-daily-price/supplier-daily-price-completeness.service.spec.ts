import { describe, expect, it, vi } from "vitest";
import { SupplierDailyPriceCompletenessService } from "./supplier-daily-price-completeness.service";

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    supplierProfile: {
      findMany: vi.fn().mockResolvedValue(overrides.suppliers ?? [{ id: "supplier-1" }]),
    },
    product: {
      findMany: vi.fn().mockResolvedValue(overrides.products ?? []),
    },
    priceSnapshot: {
      findMany: vi.fn().mockResolvedValue(overrides.snapshotsToday ?? []),
    },
  };
}

describe("SupplierDailyPriceCompletenessService", () => {
  it("returns no missing products when the supplier has no active listings", async () => {
    const prisma = makePrisma({ products: [] });
    const service = new SupplierDailyPriceCompletenessService(prisma as any);

    const result = await service.evaluateSupplier("supplier-1");

    expect(result.missingProducts).toEqual([]);
    expect(result.totalRequired).toBe(0);
  });

  it("identifies missing products when some active listings have no PriceSnapshot today", async () => {
    const prisma = makePrisma({
      products: [
        { id: "p1", name: "TMT 10mm" },
        { id: "p2", name: "TMT 12mm" },
      ],
      snapshotsToday: [{ productId: "p1" }],
    });
    const service = new SupplierDailyPriceCompletenessService(prisma as any);

    const result = await service.evaluateSupplier("supplier-1");

    expect(result.missingProducts).toEqual([{ id: "p2", name: "TMT 12mm" }]);
    expect(result.totalRequired).toBe(2);
    expect(result.totalUpdatedToday).toBe(1);
  });

  it("returns no missing products when every active listing has a PriceSnapshot today (supplier already updated)", async () => {
    const prisma = makePrisma({
      products: [
        { id: "p1", name: "TMT 10mm" },
        { id: "p2", name: "TMT 12mm" },
      ],
      snapshotsToday: [{ productId: "p1" }, { productId: "p2" }],
    });
    const service = new SupplierDailyPriceCompletenessService(prisma as any);

    const result = await service.evaluateSupplier("supplier-1");

    expect(result.missingProducts).toEqual([]);
  });

  it("evaluateAllActiveSuppliers evaluates every active supplier and tolerates a single failure", async () => {
    const prisma = makePrisma({ suppliers: [{ id: "supplier-1" }, { id: "supplier-2" }] });
    const service = new SupplierDailyPriceCompletenessService(prisma as any);
    vi.spyOn(service, "evaluateSupplier")
      .mockResolvedValueOnce({ supplierId: "supplier-1", businessDate: "2026-01-01", missingProducts: [], totalRequired: 1, totalUpdatedToday: 1 })
      .mockRejectedValueOnce(new Error("boom"));

    const results = await service.evaluateAllActiveSuppliers();

    expect(results).toHaveLength(1);
    expect(results[0].supplierId).toBe("supplier-1");
  });
});
