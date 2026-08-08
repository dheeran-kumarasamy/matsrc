import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { ALERT_SUPPRESSION_REASONS, AlertSuppressionReason } from "./alert-suppression-reason";

export type CanonicalSkuResolution =
  | { ok: true; canonicalSkuId: string }
  | { ok: false; suppressedReason: Extract<AlertSuppressionReason, "CANONICAL_SKU_UNMAPPED"> };

export type DistrictResolution =
  | { ok: true; districtId: string }
  | { ok: false; suppressedReason: Extract<AlertSuppressionReason, "DISTRICT_UNRESOLVED"> };

/**
 * Phase 6D: Watchlist Price Alert bridge.
 *
 * Bridges the existing UF-09 Watchlist model (Watchlist.productId) to the
 * Phase 6C Price Intelligence serving layer (PricingCanonicalSku +
 * PricingDistrict) WITHOUT any schema changes. This mirrors exactly the
 * resolution strategy already implemented (and approved) in
 * apps/web/app/api/builder/products/[canonicalProductId]/district-pricing/route.ts:
 *
 *   1. Exact match: PricingCanonicalSku.matsrcListingId === Product.canonicalProductId
 *   2. Fallback: unambiguous match on MaterialCategory name + Brand name.
 *   If neither resolves unambiguously -> CANONICAL_SKU_UNMAPPED.
 *
 * District resolution heuristic (explicit product decision for Phase 6D):
 *   Use the builder's single MOST-RECENTLY-CREATED ACTIVE Site if one or more
 *   exist, and match its `city` field case-insensitively against
 *   PricingDistrict.name. If the builder has zero active sites, or the site's
 *   city does not match any known PricingDistrict -> DISTRICT_UNRESOLVED.
 *   This is a lightweight heuristic, not a full geo-resolution system, and
 *   deliberately does not attempt to disambiguate multiple sites in
 *   different cities beyond "most recent wins".
 */
@Injectable()
export class WatchlistBridgeService {
  private readonly logger = new Logger(WatchlistBridgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveCanonicalSku(productId: string): Promise<CanonicalSkuResolution> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        canonicalProductId: true,
        canonicalProduct: {
          select: {
            id: true,
            category: { select: { name: true } },
            brand: { select: { name: true } },
          },
        },
      },
    });

    if (!product?.canonicalProductId || !product.canonicalProduct) {
      return { ok: false, suppressedReason: ALERT_SUPPRESSION_REASONS.CANONICAL_SKU_UNMAPPED };
    }

    let sku = await this.prisma.pricingCanonicalSku.findFirst({
      where: { matsrcListingId: product.canonicalProductId },
      select: { id: true },
    });

    if (!sku) {
      const categoryName = product.canonicalProduct.category?.name?.trim();
      const brandName = product.canonicalProduct.brand?.name?.trim();
      if (categoryName) {
        const candidates = await this.prisma.pricingCanonicalSku.findMany({
          where: {
            isActive: true,
            materialCategory: { name: { equals: categoryName, mode: "insensitive" } },
            ...(brandName ? { brand: { name: { equals: brandName, mode: "insensitive" } } } : {}),
          },
          select: { id: true },
          take: 2,
        });
        if (candidates.length === 1) {
          sku = candidates[0];
        }
      }
    }

    if (!sku) {
      return { ok: false, suppressedReason: ALERT_SUPPRESSION_REASONS.CANONICAL_SKU_UNMAPPED };
    }

    return { ok: true, canonicalSkuId: sku.id };
  }

  async resolveDistrict(builderId: string): Promise<DistrictResolution> {
    const site = await this.prisma.site.findFirst({
      where: { builderId, status: "ACTIVE", city: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { city: true },
    });

    if (!site?.city?.trim()) {
      return { ok: false, suppressedReason: ALERT_SUPPRESSION_REASONS.DISTRICT_UNRESOLVED };
    }

    const district = await this.prisma.pricingDistrict.findFirst({
      where: { name: { equals: site.city.trim(), mode: "insensitive" } },
      select: { id: true },
    });

    if (!district) {
      return { ok: false, suppressedReason: ALERT_SUPPRESSION_REASONS.DISTRICT_UNRESOLVED };
    }

    return { ok: true, districtId: district.id };
  }
}
