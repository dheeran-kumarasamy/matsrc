import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { isValidTaxPercent, resolveGstRate, type GstRateResolution } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

// Product-Level GST — admin configuration service.
//
// Precedence (see packages/db/lib/gst-rate-resolution.ts for the shared
// resolution logic consumed elsewhere): PRODUCT override -> CATEGORY
// override -> GLOBAL default. Exactly one GLOBAL row exists at any time
// (enforced here, not by a DB constraint alone — mirrors MarkupService's
// identical convention); CATEGORY/PRODUCT rows are scoped 1:1 to a
// Category.id/Product.id via the existing TaxSetting.scopeId free-text
// field (deliberately not an FK — see that model's own schema doc comment).
//
// UNLIKE MarkupService, a missing/invalid effective GST rate must NEVER be
// silently treated as 0% anywhere in this service — see TaxSetting's schema
// doc comment. This service only stores/reads configuration and reports
// resolution status to the admin UI; it does not decide confirmation-path
// fail-safe behaviour (that lives entirely in the Phase 2B+ confirmation
// writer, not here).
//
// Every write is audit-logged via the existing AuditLog model, mirroring
// MarkupService/CatalogService's established convention exactly.
@Injectable()
export class GstService {
  constructor(private readonly prisma: PrismaService) {}

  private assertValidPercentage(percentage: number) {
    if (!isValidTaxPercent(percentage)) {
      throw new BadRequestException(
        "percentage must be a non-negative, finite number (negative/NaN/Infinity values are rejected)."
      );
    }
  }

  // Returns the single GLOBAL row, or null if never configured yet (an
  // unset global default — distinct from an explicit 0%, per the "explicit
  // 0% override must be valid and distinct from an unset configuration"
  // requirement — mirrors MarkupService.getGlobal exactly).
  async getGlobal() {
    return this.prisma.taxSetting.findUnique({
      where: { scope_scopeId: { scope: "GLOBAL", scopeId: null as any } },
    });
  }

  async upsertGlobal(percentage: number, isEnabled: boolean | undefined, actorId: string) {
    this.assertValidPercentage(percentage);

    const existing = await this.getGlobal();
    const data = {
      scope: "GLOBAL" as const,
      scopeId: null,
      percentage,
      isEnabled: isEnabled ?? true,
      updatedBy: actorId,
    };

    const saved = existing
      ? await this.prisma.taxSetting.update({ where: { id: existing.id }, data })
      : await this.prisma.taxSetting.create({ data: { ...data, createdBy: actorId } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: existing ? "GST_GLOBAL_UPDATED" : "GST_GLOBAL_CREATED",
        entityType: "TaxSetting",
        entityId: saved.id,
        metadata: { percentage, isEnabled: data.isEnabled },
      },
    });

    return saved;
  }

  async getCategoryOverride(categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return this.prisma.taxSetting.findUnique({
      where: { scope_scopeId: { scope: "CATEGORY", scopeId: categoryId } },
    });
  }

  async upsertCategoryOverride(categoryId: string, percentage: number, isEnabled: boolean | undefined, actorId: string) {
    this.assertValidPercentage(percentage);

    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }

    const existing = await this.prisma.taxSetting.findUnique({
      where: { scope_scopeId: { scope: "CATEGORY", scopeId: categoryId } },
    });
    const data = {
      scope: "CATEGORY" as const,
      scopeId: categoryId,
      percentage,
      isEnabled: isEnabled ?? true,
      updatedBy: actorId,
    };

    const saved = existing
      ? await this.prisma.taxSetting.update({ where: { id: existing.id }, data })
      : await this.prisma.taxSetting.create({ data: { ...data, createdBy: actorId } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: existing ? "GST_CATEGORY_UPDATED" : "GST_CATEGORY_CREATED",
        entityType: "TaxSetting",
        entityId: saved.id,
        metadata: { categoryId, percentage, isEnabled: data.isEnabled },
      },
    });

    return saved;
  }

  async deleteCategoryOverride(categoryId: string, actorId: string) {
    const existing = await this.prisma.taxSetting.findUnique({
      where: { scope_scopeId: { scope: "CATEGORY", scopeId: categoryId } },
    });
    if (!existing) {
      throw new NotFoundException("No category override configured");
    }
    await this.prisma.taxSetting.delete({ where: { id: existing.id } });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "GST_CATEGORY_DELETED",
        entityType: "TaxSetting",
        entityId: existing.id,
        metadata: { categoryId },
      },
    });
    return { deleted: true };
  }

  async getProductOverride(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    return this.prisma.taxSetting.findUnique({
      where: { scope_scopeId: { scope: "PRODUCT", scopeId: productId } },
    });
  }

  async upsertProductOverride(productId: string, percentage: number, isEnabled: boolean | undefined, actorId: string) {
    this.assertValidPercentage(percentage);

    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const existing = await this.prisma.taxSetting.findUnique({
      where: { scope_scopeId: { scope: "PRODUCT", scopeId: productId } },
    });
    const data = {
      scope: "PRODUCT" as const,
      scopeId: productId,
      percentage,
      isEnabled: isEnabled ?? true,
      updatedBy: actorId,
    };

    const saved = existing
      ? await this.prisma.taxSetting.update({ where: { id: existing.id }, data })
      : await this.prisma.taxSetting.create({ data: { ...data, createdBy: actorId } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: existing ? "GST_PRODUCT_UPDATED" : "GST_PRODUCT_CREATED",
        entityType: "TaxSetting",
        entityId: saved.id,
        metadata: { productId, percentage, isEnabled: data.isEnabled },
      },
    });

    return saved;
  }

  async deleteProductOverride(productId: string, actorId: string) {
    const existing = await this.prisma.taxSetting.findUnique({
      where: { scope_scopeId: { scope: "PRODUCT", scopeId: productId } },
    });
    if (!existing) {
      throw new NotFoundException("No product override configured");
    }
    await this.prisma.taxSetting.delete({ where: { id: existing.id } });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "GST_PRODUCT_DELETED",
        entityType: "TaxSetting",
        entityId: existing.id,
        metadata: { productId },
      },
    });
    return { deleted: true };
  }

  // Full list view for the admin UI — every PRODUCT/CATEGORY override plus
  // the GLOBAL default, with enough context (category/product name) to
  // render without N further requests. Mirrors MarkupService.listAll.
  async listAll() {
    const [global, categories, products] = await Promise.all([
      this.getGlobal(),
      this.prisma.taxSetting.findMany({ where: { scope: "CATEGORY" }, orderBy: { updatedAt: "desc" } }),
      this.prisma.taxSetting.findMany({ where: { scope: "PRODUCT" }, orderBy: { updatedAt: "desc" } }),
    ]);

    const categoryIds = categories.map((c) => c.scopeId).filter((id): id is string => !!id);
    const productIds = products.map((p) => p.scopeId).filter((id): id is string => !!id);

    const [categoryRows, productRows] = await Promise.all([
      categoryIds.length
        ? this.prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
        : Promise.resolve([] as { id: string; name: string }[]),
      productIds.length
        ? this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);

    const categoryNameById = new Map(categoryRows.map((c) => [c.id, c.name]));
    const productNameById = new Map(productRows.map((p) => [p.id, p.name]));

    return {
      global: global
        ? { id: global.id, percentage: Number(global.percentage), isEnabled: global.isEnabled, updatedAt: global.updatedAt }
        : null,
      categoryOverrides: categories.map((row) => ({
        id: row.id,
        categoryId: row.scopeId,
        categoryName: categoryNameById.get(row.scopeId ?? "") ?? "Unknown category",
        percentage: Number(row.percentage),
        isEnabled: row.isEnabled,
        updatedAt: row.updatedAt,
      })),
      productOverrides: products.map((row) => ({
        id: row.id,
        productId: row.scopeId,
        productName: productNameById.get(row.scopeId ?? "") ?? "Unknown product",
        percentage: Number(row.percentage),
        isEnabled: row.isEnabled,
        updatedAt: row.updatedAt,
      })),
    };
  }

  // "Understand which rule is currently effective for a product, and why" —
  // resolves PRODUCT -> CATEGORY -> GLOBAL and reports EVERY tier's status
  // (ACTIVE / DISABLED / INVALID / UNSET), not just the winning one — the
  // admin UI requirement is to "explain which setting supplies the
  // effective rate and why", including when a higher-precedence tier is
  // configured but disabled/invalid and the resolver fell through to a
  // lower one. Never guesses: `effective: null` (via resolveGstRate's
  // GstRateUnresolved) when no tier is usable, matching this feature's
  // strict "never silently substitute a rate" contract.
  async getEffectiveForProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const [productOverride, categoryOverride, global] = await Promise.all([
      this.prisma.taxSetting.findUnique({ where: { scope_scopeId: { scope: "PRODUCT", scopeId: productId } } }),
      this.prisma.taxSetting.findUnique({
        where: { scope_scopeId: { scope: "CATEGORY", scopeId: product.categoryId } },
      }),
      this.getGlobal(),
    ]);

    const describeTier = (row: { percentage: unknown; isEnabled: boolean } | null) => {
      if (!row) return { configured: false as const, percentage: null, isEnabled: null, status: "UNSET" as const };
      const percentage = Number(row.percentage);
      const valid = isValidTaxPercent(percentage);
      const status: "ACTIVE" | "DISABLED" | "INVALID" = !row.isEnabled ? "DISABLED" : !valid ? "INVALID" : "ACTIVE";
      return { configured: true as const, percentage, isEnabled: row.isEnabled, status };
    };

    const resolution: GstRateResolution = resolveGstRate({
      product: productOverride ? { percentage: Number(productOverride.percentage), isEnabled: productOverride.isEnabled } : null,
      category: categoryOverride ? { percentage: Number(categoryOverride.percentage), isEnabled: categoryOverride.isEnabled } : null,
      global: global ? { percentage: Number(global.percentage), isEnabled: global.isEnabled } : null,
    });

    return {
      productId,
      categoryId: product.categoryId,
      productOverride: describeTier(productOverride),
      categoryOverride: describeTier(categoryOverride),
      global: describeTier(global),
      effective: resolution.resolved ? { source: resolution.scope, percentage: resolution.percentage } : null,
      unresolvedReason: resolution.resolved ? null : resolution.reason,
    };
  }

  // Product Tax-Coverage Worklist — identifies which products would block a
  // future confirmation flow because no valid effective GST rate resolves
  // for them (see resolveGstRate's "never silently substitute a rate"
  // contract). Never invents or backfills a rate; never infers a rate from
  // Product.hsnCode (no verified HSN->rate mapping exists anywhere in this
  // repository). Paginated like listScrapedPrices
  // (pricing-admin-ops.service.ts) — this table can grow to one row per
  // active product.
  async listTaxCoverage(filters: {
    categoryId?: string;
    search?: string;
    onlyMissing?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 50;

    const where: Record<string, unknown> = { isActive: true };
    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.search) {
      const term = filters.search.trim();
      if (term) where.name = { contains: term, mode: "insensitive" };
    }

    const [products, total, allCategoryTaxRows, allProductTaxRows, global] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, name: true, categoryId: true, category: { select: { name: true } } },
      }),
      this.prisma.product.count({ where }),
      this.prisma.taxSetting.findMany({ where: { scope: "CATEGORY" } }),
      this.prisma.taxSetting.findMany({ where: { scope: "PRODUCT" } }),
      this.getGlobal(),
    ]);

    const categoryTaxByCategoryId = new Map(allCategoryTaxRows.map((row) => [row.scopeId, row]));
    const productTaxByProductId = new Map(allProductTaxRows.map((row) => [row.scopeId, row]));
    const globalTier = global ? { percentage: Number(global.percentage), isEnabled: global.isEnabled } : null;

    const rows = products.map((product) => {
      const productRow = productTaxByProductId.get(product.id) ?? null;
      const categoryRow = categoryTaxByCategoryId.get(product.categoryId) ?? null;

      const productTier = productRow ? { percentage: Number(productRow.percentage), isEnabled: productRow.isEnabled } : null;
      const categoryTier = categoryRow ? { percentage: Number(categoryRow.percentage), isEnabled: categoryRow.isEnabled } : null;

      const resolution = resolveGstRate({ product: productTier, category: categoryTier, global: globalTier });

      // Surface a disabled/invalid HIGHER-precedence tier even when a
      // lower one successfully resolves — the UI requirement is to never
      // silently conceal an override's disabled/invalid status.
      const fallthroughNotices: string[] = [];
      if (productRow && (!productRow.isEnabled || !isValidTaxPercent(Number(productRow.percentage)))) {
        fallthroughNotices.push(
          `Product-level override is ${!productRow.isEnabled ? "disabled" : "invalid"} — falling through.`
        );
      }
      if (
        (!productRow || !productRow.isEnabled || !isValidTaxPercent(Number(productRow.percentage))) &&
        categoryRow &&
        (!categoryRow.isEnabled || !isValidTaxPercent(Number(categoryRow.percentage)))
      ) {
        fallthroughNotices.push(
          `Category-level override is ${!categoryRow.isEnabled ? "disabled" : "invalid"} — falling through.`
        );
      }

      return {
        productId: product.id,
        productName: product.name,
        categoryId: product.categoryId,
        categoryName: product.category.name,
        productSetting: productTier ? { percentage: productTier.percentage, isEnabled: productTier.isEnabled } : null,
        effective: resolution.resolved ? { source: resolution.scope, percentage: resolution.percentage } : null,
        missing: !resolution.resolved,
        unresolvedReason: resolution.resolved ? null : resolution.reason,
        fallthroughNotices,
      };
    });

    const filtered = filters.onlyMissing ? rows.filter((row) => row.missing) : rows;

    return { rows: filtered, total, page, pageSize };
  }
}
