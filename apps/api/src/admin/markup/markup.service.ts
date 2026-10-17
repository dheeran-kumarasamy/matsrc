import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { isValidMarkupPercent, resolveMarkupForProduct, type MarkupCalculationResult } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

// Admin-Configurable Product Markup — admin configuration service.
//
// Precedence (see packages/db/lib/markup-calculation.ts for the shared
// resolution logic consumed elsewhere): PRODUCT override -> CATEGORY
// override -> GLOBAL default. Exactly one GLOBAL row exists at any time
// (enforced here, not by a DB constraint alone — see upsertGlobal below);
// CATEGORY/PRODUCT rows are scoped 1:1 to a Category.id/Product.id via the
// existing MarkupSetting.scopeId free-text field (deliberately not an FK —
// see that model's own schema doc comment).
//
// Every write is audit-logged via the existing AuditLog model, mirroring
// CatalogService's established convention exactly.
@Injectable()
export class MarkupService {
  constructor(private readonly prisma: PrismaService) {}

  private assertValidPercentage(percentage: number) {
    if (!isValidMarkupPercent(percentage)) {
      throw new BadRequestException(
        "percentage must be a non-negative, finite number (negative/NaN/Infinity values are rejected)."
      );
    }
  }

  // Returns the single GLOBAL row, or null if never configured yet (an
  // unset global default — distinct from an explicit 0%, per the "explicit
  // 0% override must be valid and distinct from an unset configuration"
  // requirement).
  async getGlobal() {
    return this.prisma.markupSetting.findUnique({
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
      ? await this.prisma.markupSetting.update({ where: { id: existing.id }, data })
      : await this.prisma.markupSetting.create({ data: { ...data, createdBy: actorId } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: existing ? "MARKUP_GLOBAL_UPDATED" : "MARKUP_GLOBAL_CREATED",
        entityType: "MarkupSetting",
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
    return this.prisma.markupSetting.findUnique({
      where: { scope_scopeId: { scope: "CATEGORY", scopeId: categoryId } },
    });
  }

  async upsertCategoryOverride(categoryId: string, percentage: number, isEnabled: boolean | undefined, actorId: string) {
    this.assertValidPercentage(percentage);

    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }

    const existing = await this.prisma.markupSetting.findUnique({
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
      ? await this.prisma.markupSetting.update({ where: { id: existing.id }, data })
      : await this.prisma.markupSetting.create({ data: { ...data, createdBy: actorId } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: existing ? "MARKUP_CATEGORY_UPDATED" : "MARKUP_CATEGORY_CREATED",
        entityType: "MarkupSetting",
        entityId: saved.id,
        metadata: { categoryId, percentage, isEnabled: data.isEnabled },
      },
    });

    return saved;
  }

  async deleteCategoryOverride(categoryId: string, actorId: string) {
    const existing = await this.prisma.markupSetting.findUnique({
      where: { scope_scopeId: { scope: "CATEGORY", scopeId: categoryId } },
    });
    if (!existing) {
      throw new NotFoundException("No category override configured");
    }
    await this.prisma.markupSetting.delete({ where: { id: existing.id } });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "MARKUP_CATEGORY_DELETED",
        entityType: "MarkupSetting",
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
    return this.prisma.markupSetting.findUnique({
      where: { scope_scopeId: { scope: "PRODUCT", scopeId: productId } },
    });
  }

  async upsertProductOverride(productId: string, percentage: number, isEnabled: boolean | undefined, actorId: string) {
    this.assertValidPercentage(percentage);

    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const existing = await this.prisma.markupSetting.findUnique({
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
      ? await this.prisma.markupSetting.update({ where: { id: existing.id }, data })
      : await this.prisma.markupSetting.create({ data: { ...data, createdBy: actorId } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: existing ? "MARKUP_PRODUCT_UPDATED" : "MARKUP_PRODUCT_CREATED",
        entityType: "MarkupSetting",
        entityId: saved.id,
        metadata: { productId, percentage, isEnabled: data.isEnabled },
      },
    });

    return saved;
  }

  async deleteProductOverride(productId: string, actorId: string) {
    const existing = await this.prisma.markupSetting.findUnique({
      where: { scope_scopeId: { scope: "PRODUCT", scopeId: productId } },
    });
    if (!existing) {
      throw new NotFoundException("No product override configured");
    }
    await this.prisma.markupSetting.delete({ where: { id: existing.id } });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "MARKUP_PRODUCT_DELETED",
        entityType: "MarkupSetting",
        entityId: existing.id,
        metadata: { productId },
      },
    });
    return { deleted: true };
  }

  // Full list view for the admin UI — every PRODUCT/CATEGORY override plus
  // the GLOBAL default, with enough context (category/product name) to
  // render without N further requests.
  async listAll() {
    const [global, categories, products] = await Promise.all([
      this.getGlobal(),
      this.prisma.markupSetting.findMany({ where: { scope: "CATEGORY" }, orderBy: { updatedAt: "desc" } }),
      this.prisma.markupSetting.findMany({ where: { scope: "PRODUCT" }, orderBy: { updatedAt: "desc" } }),
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

  // "Understand which rule is currently effective for a product" — resolves
  // and returns the EFFECTIVE tier (product -> category -> global) for a
  // given product. Never guesses: returns `effective: null` if no tier is
  // enabled, matching resolveEffectiveMarkupPercent's own "fail safely"
  // contract.
  async getEffectiveForProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const [productOverride, categoryOverride, global] = await Promise.all([
      this.prisma.markupSetting.findUnique({ where: { scope_scopeId: { scope: "PRODUCT", scopeId: productId } } }),
      this.prisma.markupSetting.findUnique({
        where: { scope_scopeId: { scope: "CATEGORY", scopeId: product.categoryId } },
      }),
      this.getGlobal(),
    ]);

    const tiers = [
      { source: "PRODUCT" as const, row: productOverride },
      { source: "CATEGORY" as const, row: categoryOverride },
      { source: "GLOBAL" as const, row: global },
    ];
    const effective = tiers.find((t) => t.row && t.row.isEnabled);

    return {
      productId,
      productOverride: productOverride
        ? { percentage: Number(productOverride.percentage), isEnabled: productOverride.isEnabled }
        : null,
      categoryOverride: categoryOverride
        ? { percentage: Number(categoryOverride.percentage), isEnabled: categoryOverride.isEnabled }
        : null,
      global: global ? { percentage: Number(global.percentage), isEnabled: global.isEnabled } : null,
      effective: effective ? { source: effective.source, percentage: Number(effective.row!.percentage) } : null,
    };
  }

  // Shared pricing-resolution entry point — used by every authoritative
  // buyer-facing price-setting call site (checkout, RFQ best-price
  // selection) so there is exactly ONE place the PRODUCT->CATEGORY->GLOBAL
  // precedence is actually looked up against the database. Delegates the
  // pure precedence/calculation logic to
  // packages/db/lib/markup-calculation.ts's resolveMarkupForProduct — this
  // method only adds the Prisma/NestJS wiring. Returns null (never 0, never
  // a guessed fallback) when no enabled markup setting exists at any tier —
  // callers must decide their own safe behaviour for "no markup
  // configured" (see call sites for the documented decision).
  async resolveMarkupForProduct(params: {
    productId: string;
    categoryId: string;
    supplierUnitPrice: number;
  }): Promise<MarkupCalculationResult | null> {
    return resolveMarkupForProduct(this.prisma as any, params);
  }
}
