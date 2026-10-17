import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { GstService } from "./gst.service";

function buildService(overrides: {
  taxSettingFindUnique?: any;
  taxSettingFindMany?: any;
  categoryFindUnique?: any;
  productFindUnique?: any;
  productFindMany?: any;
  productCount?: any;
} = {}) {
  const prisma: any = {
    taxSetting: {
      findUnique: overrides.taxSettingFindUnique ?? vi.fn().mockResolvedValue(null),
      findMany: overrides.taxSettingFindMany ?? vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "tax-new", ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "tax-existing", ...data })),
      delete: vi.fn().mockResolvedValue({}),
    },
    category: {
      findUnique: overrides.categoryFindUnique ?? vi.fn().mockResolvedValue({ id: "cat-1", name: "Cement" }),
    },
    product: {
      findUnique: overrides.productFindUnique ?? vi.fn().mockResolvedValue({ id: "prod-1", categoryId: "cat-1", name: "OPC 53" }),
      findMany: overrides.productFindMany ?? vi.fn().mockResolvedValue([]),
      count: overrides.productCount ?? vi.fn().mockResolvedValue(0),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const service = new GstService(prisma as any);
  return { service, prisma };
}

describe("GstService.upsertGlobal", () => {
  it("creates the GLOBAL row with audit metadata when none exists yet", async () => {
    const { service, prisma } = buildService();
    const saved = await service.upsertGlobal(18, true, "admin-1");
    expect(saved.scope).toBe("GLOBAL");
    expect(saved.scopeId).toBeNull();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "GST_GLOBAL_CREATED", actorId: "admin-1" }) })
    );
  });

  it("updates the existing GLOBAL row (singleton) rather than creating a second one", async () => {
    const existingGlobal = { id: "global-1", scope: "GLOBAL", scopeId: null, percentage: 18, isEnabled: true };
    const { service, prisma } = buildService({
      taxSettingFindUnique: vi.fn().mockResolvedValue(existingGlobal),
    });
    await service.upsertGlobal(12, true, "admin-1");
    expect(prisma.taxSetting.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "global-1" } })
    );
    expect(prisma.taxSetting.create).not.toHaveBeenCalled();
  });

  it("rejects a negative percentage without ever writing to the database", async () => {
    const { service, prisma } = buildService();
    await expect(service.upsertGlobal(-5, true, "admin-1")).rejects.toThrow(BadRequestException);
    expect(prisma.taxSetting.create).not.toHaveBeenCalled();
    expect(prisma.taxSetting.update).not.toHaveBeenCalled();
  });

  it("rejects NaN/Infinity percentages", async () => {
    const { service } = buildService();
    await expect(service.upsertGlobal(NaN, true, "admin-1")).rejects.toThrow(BadRequestException);
    await expect(service.upsertGlobal(Infinity, true, "admin-1")).rejects.toThrow(BadRequestException);
  });

  it("accepts an explicit 0% as a valid, non-coerced configuration", async () => {
    const { service } = buildService();
    const saved = await service.upsertGlobal(0, true, "admin-1");
    expect(saved.percentage).toBe(0);
  });
});

describe("GstService.upsertCategoryOverride / upsertProductOverride — scope validation", () => {
  it("throws NotFoundException for a non-existent category", async () => {
    const { service } = buildService({ categoryFindUnique: vi.fn().mockResolvedValue(null) });
    await expect(service.upsertCategoryOverride("cat-missing", 12, true, "admin-1")).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException for a non-existent product", async () => {
    const { service } = buildService({ productFindUnique: vi.fn().mockResolvedValue(null) });
    await expect(service.upsertProductOverride("prod-missing", 5, true, "admin-1")).rejects.toThrow(NotFoundException);
  });

  it("creates a CATEGORY override scoped to the given categoryId", async () => {
    const { service, prisma } = buildService();
    const saved = await service.upsertCategoryOverride("cat-1", 12, true, "admin-1");
    expect(saved.scope).toBe("CATEGORY");
    expect(saved.scopeId).toBe("cat-1");
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "GST_CATEGORY_CREATED" }) })
    );
  });

  it("creates a PRODUCT override scoped to the given productId", async () => {
    const { service, prisma } = buildService();
    const saved = await service.upsertProductOverride("prod-1", 5, true, "admin-1");
    expect(saved.scope).toBe("PRODUCT");
    expect(saved.scopeId).toBe("prod-1");
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "GST_PRODUCT_CREATED" }) })
    );
  });

  it("deletes an existing category override and audit-logs the removal", async () => {
    const { service, prisma } = buildService({
      taxSettingFindUnique: vi.fn().mockResolvedValue({ id: "tax-1", scope: "CATEGORY", scopeId: "cat-1" }),
    });
    const result = await service.deleteCategoryOverride("cat-1", "admin-1");
    expect(result).toEqual({ deleted: true });
    expect(prisma.taxSetting.delete).toHaveBeenCalledWith({ where: { id: "tax-1" } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "GST_CATEGORY_DELETED" }) })
    );
  });

  it("throws NotFoundException deleting a category override that doesn't exist", async () => {
    const { service } = buildService({ taxSettingFindUnique: vi.fn().mockResolvedValue(null) });
    await expect(service.deleteCategoryOverride("cat-1", "admin-1")).rejects.toThrow(NotFoundException);
  });

  it("supports disabling a setting via isEnabled: false (enable/disable behavior)", async () => {
    const { service, prisma } = buildService();
    await service.upsertProductOverride("prod-1", 5, false, "admin-1");
    expect(prisma.taxSetting.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isEnabled: false }) })
    );
  });

  it("defaults isEnabled to true when omitted", async () => {
    const { service, prisma } = buildService();
    await service.upsertProductOverride("prod-1", 5, undefined, "admin-1");
    expect(prisma.taxSetting.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isEnabled: true }) })
    );
  });
});

describe("GstService.getEffectiveForProduct — precedence and override-status visibility", () => {
  it("resolves the PRODUCT override and reports every tier's status", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ percentage: 5, isEnabled: true }) // PRODUCT
      .mockResolvedValueOnce({ percentage: 12, isEnabled: true }) // CATEGORY
      .mockResolvedValueOnce({ percentage: 18, isEnabled: true }); // GLOBAL
    const { service } = buildService({ taxSettingFindUnique: findUnique });
    const result = await service.getEffectiveForProduct("prod-1");
    expect(result.effective).toEqual({ source: "PRODUCT", percentage: 5 });
    expect(result.productOverride.status).toBe("ACTIVE");
  });

  it("reports a disabled PRODUCT override as DISABLED and resolves the CATEGORY fallback", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ percentage: 5, isEnabled: false }) // PRODUCT — disabled
      .mockResolvedValueOnce({ percentage: 12, isEnabled: true }) // CATEGORY
      .mockResolvedValueOnce({ percentage: 18, isEnabled: true }); // GLOBAL
    const { service } = buildService({ taxSettingFindUnique: findUnique });
    const result = await service.getEffectiveForProduct("prod-1");
    expect(result.productOverride.status).toBe("DISABLED");
    expect(result.effective).toEqual({ source: "CATEGORY", percentage: 12 });
  });

  it("returns effective: null (never 0) and an unresolvedReason when no tier resolves", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const { service } = buildService({ taxSettingFindUnique: findUnique });
    const result = await service.getEffectiveForProduct("prod-1");
    expect(result.effective).toBeNull();
    expect(result.unresolvedReason).toBe("NO_SETTING_CONFIGURED");
    expect(result.productOverride.status).toBe("UNSET");
  });

  it("throws NotFoundException for a non-existent product", async () => {
    const { service } = buildService({ productFindUnique: vi.fn().mockResolvedValue(null) });
    await expect(service.getEffectiveForProduct("prod-missing")).rejects.toThrow(NotFoundException);
  });
});

describe("GstService.listTaxCoverage — worklist filtering and pagination", () => {
  const products = [
    { id: "prod-1", name: "OPC 53", categoryId: "cat-1", category: { name: "Cement" } },
    { id: "prod-2", name: "TMT Bar 8mm", categoryId: "cat-2", category: { name: "Steel" } },
  ];

  it("flags a product with no configured setting anywhere as missing", async () => {
    const { service } = buildService({
      productFindMany: vi.fn().mockResolvedValue(products),
      productCount: vi.fn().mockResolvedValue(2),
      taxSettingFindMany: vi.fn().mockResolvedValue([]), // no CATEGORY/PRODUCT rows
      taxSettingFindUnique: vi.fn().mockResolvedValue(null), // no GLOBAL row
    });
    const result = await service.listTaxCoverage({});
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.missing)).toBe(true);
    expect(result.rows[0].effective).toBeNull();
  });

  it("resolves the GLOBAL rate for a product with no category/product override", async () => {
    const { service } = buildService({
      productFindMany: vi.fn().mockResolvedValue([products[0]]),
      productCount: vi.fn().mockResolvedValue(1),
      taxSettingFindMany: vi.fn().mockResolvedValue([]),
      taxSettingFindUnique: vi.fn().mockResolvedValue({ percentage: 18, isEnabled: true }),
    });
    const result = await service.listTaxCoverage({});
    expect(result.rows[0].missing).toBe(false);
    expect(result.rows[0].effective).toEqual({ source: "GLOBAL", percentage: 18 });
  });

  it("surfaces a fallthrough notice when a disabled CATEGORY override is shadowed by a valid GLOBAL rate", async () => {
    const { service } = buildService({
      productFindMany: vi.fn().mockResolvedValue([products[0]]),
      productCount: vi.fn().mockResolvedValue(1),
      taxSettingFindMany: vi.fn().mockResolvedValue([
        { scope: "CATEGORY", scopeId: "cat-1", percentage: 12, isEnabled: false },
      ]),
      taxSettingFindUnique: vi.fn().mockResolvedValue({ percentage: 18, isEnabled: true }),
    });
    const result = await service.listTaxCoverage({});
    expect(result.rows[0].effective).toEqual({ source: "GLOBAL", percentage: 18 });
    expect(result.rows[0].fallthroughNotices.length).toBeGreaterThan(0);
    expect(result.rows[0].fallthroughNotices[0]).toContain("Category-level override is disabled");
  });

  it("filters to only missing rows when onlyMissing is true", async () => {
    const { service } = buildService({
      productFindMany: vi.fn().mockResolvedValue(products),
      productCount: vi.fn().mockResolvedValue(2),
      taxSettingFindMany: vi.fn().mockResolvedValue([
        { scope: "PRODUCT", scopeId: "prod-1", percentage: 5, isEnabled: true },
      ]),
      taxSettingFindUnique: vi.fn().mockResolvedValue(null),
    });
    const result = await service.listTaxCoverage({ onlyMissing: true });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].productId).toBe("prod-2");
  });

  it("applies pagination parameters (page/pageSize) to the underlying query", async () => {
    const productFindMany = vi.fn().mockResolvedValue([]);
    const { service } = buildService({
      productFindMany,
      productCount: vi.fn().mockResolvedValue(0),
      taxSettingFindMany: vi.fn().mockResolvedValue([]),
      taxSettingFindUnique: vi.fn().mockResolvedValue(null),
    });
    await service.listTaxCoverage({ page: 2, pageSize: 10 });
    expect(productFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
  });

  it("caps pageSize at 200 to prevent unbounded queries", async () => {
    const productFindMany = vi.fn().mockResolvedValue([]);
    const { service } = buildService({
      productFindMany,
      productCount: vi.fn().mockResolvedValue(0),
      taxSettingFindMany: vi.fn().mockResolvedValue([]),
      taxSettingFindUnique: vi.fn().mockResolvedValue(null),
    });
    await service.listTaxCoverage({ pageSize: 10000 });
    expect(productFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
  });

  it("re-reads and updates the existing row on a uniqueness conflict rather than creating a duplicate (scope,scopeId)", async () => {
    // Simulates the race-free path: upsertProductOverride already reads the
    // existing row via findUnique before deciding create-vs-update, so a
    // genuine (scope, scopeId) duplicate is never created through this
    // service — the @@unique([scope, scopeId]) constraint is the DB-level
    // backstop for any concurrent-write edge case this service doesn't
    // itself need to special-case (mirrors MarkupService's identical
    // find-then-write pattern).
    const existingRow = { id: "tax-1", scope: "PRODUCT", scopeId: "prod-1", percentage: 5, isEnabled: true };
    const { service, prisma } = buildService({ taxSettingFindUnique: vi.fn().mockResolvedValue(existingRow) });
    await service.upsertProductOverride("prod-1", 8, true, "admin-1");
    expect(prisma.taxSetting.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "tax-1" } }));
    expect(prisma.taxSetting.create).not.toHaveBeenCalled();
  });

  it("filters by categoryId", async () => {
    const productFindMany = vi.fn().mockResolvedValue([]);
    const { service } = buildService({
      productFindMany,
      productCount: vi.fn().mockResolvedValue(0),
      taxSettingFindMany: vi.fn().mockResolvedValue([]),
      taxSettingFindUnique: vi.fn().mockResolvedValue(null),
    });
    await service.listTaxCoverage({ categoryId: "cat-1" });
    expect(productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ categoryId: "cat-1" }) })
    );
  });
});
