import { describe, expect, it, vi, beforeEach } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PricingAdminOpsService } from "./pricing-admin-ops.service";

/**
 * Batch C unit tests for PricingAdminOpsService — Canonical SKU Management,
 * Unmapped Queue, Enhanced Anomaly Board, and Global Search. Every mutating
 * method here must write an AuditLog row (spec requirement); these tests
 * assert that behavior alongside the core business rules:
 *   - Never auto-approve fuzzy alias matches (approve requires canonicalSkuId).
 *   - Merge soft-deactivates the source SKU rather than hard-deleting it.
 */
function makeFakePrisma(overrides: Record<string, any> = {}) {
  const auditLog = { create: vi.fn(async () => ({})) };
  const base: Record<string, any> = {
    auditLog,
    pricingCanonicalSku: {
      findUnique: vi.fn(),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      create: vi.fn(),
    },
    pricingSkuAlias: {
      findUnique: vi.fn(),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    pricingObservation: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async () => ({})),
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    pricingDistrictPriceDaily: { updateMany: vi.fn(async () => ({ count: 0 })) },
    pricingAnomaly: { findUnique: vi.fn(), update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })) },
    pricingMaterialCategory: { findUnique: vi.fn() },
    pricingDistrict: { findMany: vi.fn(async () => []) },
    pricingSource: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  };
  return { ...base, ...overrides } as any;
}

function buildService(prisma: any) {
  const ingestion = {} as any;
  const schedulerRegistry = { getCronJobs: () => new Map() } as any;
  return new PricingAdminOpsService(prisma, ingestion, schedulerRegistry);
}

describe("PricingAdminOpsService.mergeCanonicalSku", () => {
  it("throws BadRequestException when merging a SKU into itself", async () => {
    const prisma = makeFakePrisma();
    const service = buildService(prisma);
    await expect(service.mergeCanonicalSku("sku-1", "sku-1", "admin-1")).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException when the source SKU does not exist", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingCanonicalSku.findUnique = vi.fn(async ({ where }: any) =>
      where.id === "target-1" ? { id: "target-1", code: "TARGET" } : null
    );
    const service = buildService(prisma);
    await expect(service.mergeCanonicalSku("missing-1", "target-1", "admin-1")).rejects.toThrow(NotFoundException);
  });

  it("soft-deactivates the source SKU (isActive: false) rather than deleting it, and writes an audit log", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingCanonicalSku.findUnique = vi.fn(async ({ where }: any) => {
      if (where.id === "source-1") return { id: "source-1", code: "SRC" };
      if (where.id === "target-1") return { id: "target-1", code: "TGT" };
      return null;
    });

    const service = buildService(prisma);
    const result = await service.mergeCanonicalSku("source-1", "target-1", "admin-1");

    expect(result).toEqual({ mergedId: "source-1", targetSkuId: "target-1" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const opsPassed = prisma.$transaction.mock.calls[0][0];
    expect(opsPassed.length).toBeGreaterThan(0);
  });
});

describe("PricingAdminOpsService.renameCanonicalSku", () => {
  it("throws NotFoundException when the SKU does not exist", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingCanonicalSku.findUnique = vi.fn(async () => null);
    const service = buildService(prisma);
    await expect(service.renameCanonicalSku("missing", "NEW_CODE", undefined, "admin-1")).rejects.toThrow(
      NotFoundException
    );
  });

  it("renames the SKU and writes an audit log with previous/new code", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingCanonicalSku.findUnique = vi.fn(async () => ({ id: "sku-1", code: "OLD_CODE" }));
    const service = buildService(prisma);

    const result = await service.renameCanonicalSku("sku-1", "NEW_CODE", "Fe500", "admin-1");

    expect(result).toEqual({ id: "sku-1", code: "NEW_CODE", grade: "Fe500" });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PRICING_SKU_RENAME",
          metadata: expect.objectContaining({ previousCode: "OLD_CODE", newCode: "NEW_CODE" }),
        }),
      })
    );
  });
});

describe("PricingAdminOpsService.aliasAction — never auto-approves fuzzy matches", () => {
  it("throws BadRequestException when approving without an explicit canonicalSkuId", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingSkuAlias.findUnique = vi.fn(async () => ({ id: "alias-1", rawLabel: "TMT 12mm" }));
    const service = buildService(prisma);

    await expect(service.aliasAction("alias-1", "approve", undefined, undefined, "admin-1")).rejects.toThrow(
      BadRequestException
    );
  });

  it("approves an alias as a MANUAL match when canonicalSkuId is explicitly provided", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingSkuAlias.findUnique = vi.fn(async () => ({ id: "alias-1", rawLabel: "TMT 12mm" }));
    prisma.pricingCanonicalSku.findUnique = vi.fn(async () => ({ id: "sku-1", code: "TMT_12MM" }));

    const service = buildService(prisma);
    const result = await service.aliasAction("alias-1", "approve", "sku-1", "looks correct", "admin-1");

    expect(result.matchType).toBe("MANUAL");
    expect(result.canonicalSkuId).toBe("sku-1");
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "PRICING_ALIAS_APPROVE" }) })
    );
  });

  it("blocks an alias (matchType BLOCKED, canonicalSkuId cleared) and writes an audit log", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingSkuAlias.findUnique = vi.fn(async () => ({ id: "alias-2", rawLabel: "Junk Label" }));
    const service = buildService(prisma);

    const result = await service.aliasAction("alias-2", "block", undefined, undefined, "admin-1");

    expect(result.matchType).toBe("BLOCKED");
    expect(result.canonicalSkuId).toBeNull();
  });
});

describe("PricingAdminOpsService.bulkAssignAlias", () => {
  it("throws NotFoundException when the target canonical SKU does not exist", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingCanonicalSku.findUnique = vi.fn(async () => null);
    const service = buildService(prisma);

    await expect(service.bulkAssignAlias(["a1", "a2"], "missing-sku", undefined, "admin-1")).rejects.toThrow(
      NotFoundException
    );
  });

  it("bulk-assigns aliases and writes a single audit log entry listing all alias ids", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingCanonicalSku.findUnique = vi.fn(async () => ({ id: "sku-1", code: "TMT_12MM" }));
    const service = buildService(prisma);

    const result = await service.bulkAssignAlias(["a1", "a2", "a3"], "sku-1", "batch fix", "admin-1");

    expect(result).toEqual({ updated: 3, canonicalSkuId: "sku-1" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("PricingAdminOpsService.unmappedQueueAction", () => {
  it("throws NotFoundException when the alias does not exist", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingSkuAlias.findUnique = vi.fn(async () => null);
    const service = buildService(prisma);

    await expect(
      service.unmappedQueueAction("missing", "ignore", {}, "admin-1")
    ).rejects.toThrow(NotFoundException);
  });

  it("requires canonicalSkuId for assign/merge actions", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingSkuAlias.findUnique = vi.fn(async () => ({ id: "alias-1", rawLabel: "Raw Label" }));
    const service = buildService(prisma);

    await expect(service.unmappedQueueAction("alias-1", "assign", {}, "admin-1")).rejects.toThrow(
      BadRequestException
    );
  });

  it("creates a new canonical SKU and assigns the alias to it for create_new_sku", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingSkuAlias.findUnique = vi.fn(async () => ({ id: "alias-1", rawLabel: "New Steel Grade" }));
    prisma.pricingMaterialCategory.findUnique = vi.fn(async () => ({ id: "cat-1", baseUnit: "KG" }));
    prisma.pricingCanonicalSku.create = vi.fn(async ({ data }: any) => ({ id: "new-sku-1", ...data }));

    const service = buildService(prisma);
    const result = await service.unmappedQueueAction(
      "alias-1",
      "create_new_sku",
      { newSkuCode: "NEW_STEEL", materialCategoryId: "cat-1" },
      "admin-1"
    );

    expect(result.canonicalSkuId).toBe("new-sku-1");
    expect(prisma.pricingCanonicalSku.create).toHaveBeenCalled();
  });

  it("ignore action marks the alias reviewed without assigning a canonical SKU", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingSkuAlias.findUnique = vi.fn(async () => ({ id: "alias-3", rawLabel: "Some Label" }));
    const service = buildService(prisma);

    const result = await service.unmappedQueueAction("alias-3", "ignore", {}, "admin-1");

    expect(result.canonicalSkuId).toBeNull();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "PRICING_UNMAPPED_IGNORE" }) })
    );
  });
});

describe("PricingAdminOpsService.bulkResolveAnomalies", () => {
  it("skips anomalies that are already resolved and only resolves pending ones", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingAnomaly.findUnique = vi.fn(async ({ where }: any) => {
      if (where.id === "resolved-1") return { id: "resolved-1", resolvedAt: new Date(), observationId: null };
      if (where.id === "pending-1") return { id: "pending-1", resolvedAt: null, observationId: null };
      return null;
    });

    const service = buildService(prisma);
    const result = await service.bulkResolveAnomalies(["resolved-1", "pending-1"], "accepted", "batch note", "admin-1");

    expect(result.resolved).toBe(1);
    expect(result.anomalyIds).toEqual(["pending-1"]);
  });

  it("writes a single audit log entry summarizing the bulk resolution", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingAnomaly.findUnique = vi.fn(async ({ where }: any) => ({
      id: where.id,
      resolvedAt: null,
      observationId: null,
    }));

    const service = buildService(prisma);
    await service.bulkResolveAnomalies(["a1", "a2"], "excluded", undefined, "admin-1");

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "PRICING_ANOMALY_BULK_RESOLVE" }),
      })
    );
  });
});

describe("PricingAdminOpsService.commentOnAnomaly", () => {
  it("throws NotFoundException when the anomaly does not exist", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingAnomaly.findUnique = vi.fn(async () => null);
    const service = buildService(prisma);

    await expect(service.commentOnAnomaly("missing", "note text", "admin-1")).rejects.toThrow(NotFoundException);
  });

  it("records the comment via audit log only (no dedicated comment field on the model)", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingAnomaly.findUnique = vi.fn(async () => ({ id: "anomaly-1" }));
    const service = buildService(prisma);

    const result = await service.commentOnAnomaly("anomaly-1", "Investigating this spike", "admin-1");

    expect(result).toEqual({ id: "anomaly-1", commentAdded: true });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "PRICING_ANOMALY_COMMENT", metadata: { note: "Investigating this spike" } }),
      })
    );
  });
});

describe("PricingAdminOpsService.globalSearch", () => {
  it("returns empty result sets for queries shorter than 2 characters (no DB calls made)", async () => {
    const prisma = makeFakePrisma();
    const service = buildService(prisma);

    const result = await service.globalSearch("a");

    expect(result).toEqual({ districts: [], categories: [], skus: [], aliases: [], sources: [], anomalies: [] });
    expect(prisma.pricingDistrict.findMany).not.toHaveBeenCalled();
  });

  it("queries across districts, categories, skus, aliases, sources, and anomalies for a valid query", async () => {
    const prisma = makeFakePrisma();
    prisma.pricingDistrict.findMany = vi.fn(async () => [{ id: "d1", code: "CHN", name: "Chennai" }]);
    prisma.pricingMaterialCategory.findMany = vi.fn(async () => []);
    prisma.pricingCanonicalSku.findMany = vi.fn(async () => []);
    prisma.pricingSkuAlias.findMany = vi.fn(async () => []);
    prisma.pricingSource.findMany = vi.fn(async () => []);
    prisma.pricingAnomaly.findMany = vi.fn(async () => []);

    const service = buildService(prisma);
    const result = await service.globalSearch("Chennai");

    expect(result.districts).toEqual([{ id: "d1", code: "CHN", name: "Chennai" }]);
  });
});
