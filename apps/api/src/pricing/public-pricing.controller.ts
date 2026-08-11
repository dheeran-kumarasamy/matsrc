import { Controller, Get, Header, NotFoundException, Query } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { PricingResolutionService } from "./pricing-resolution.service";

// NOTE: Same convention as PublicInsightsController — public pricing routes
// must always be served dynamically (no-store). Do not remove these headers.
const NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate";

/**
 * Phase 4 public read surface for the Price Intelligence serving layer.
 *
 * Both endpoints are strictly read-only and filtered to rows that are safe
 * to show publicly:
 *   - District daily price: filtered directly on
 *     PricingDistrictPriceDaily.publicDisplayAllowed (the column the schema
 *     comment explicitly designates for this purpose).
 *   - Monthly trend: PricingTrendMonthly has no publicDisplayAllowed column
 *     of its own (design decision, flagged in the Phase 4 summary), so
 *     visibility is gated by requiring at least one publicly-displayable
 *     PricingDistrictPriceDaily row for the same (canonicalSkuId,
 *     districtId) within that month — if none exists, the trend row is
 *     treated as not publicly visible and omitted, never fabricated as
 *     "visible by default".
 */
@Controller("public/pricing")
export class PublicPricingController {
  constructor(private readonly prisma: PrismaService, private readonly resolution: PricingResolutionService) {}

  /**
   * Phase 6F — Geographic Pricing Hierarchy resolution endpoint. Returns the
   * best available price for a canonicalSkuCode + districtCode, applying
   * DISTRICT > STATE > NATIONAL precedence via PricingResolutionService.
   * Response shape follows spec §19 — additive fields only
   * (geographyLevel/state/district/requestedDistrict/fallbackUsed/
   * fallbackReason), no breaking change to the existing district-daily /
   * trend-monthly response shapes above.
   */
  @Get("resolve")
  @Header("Cache-Control", NO_STORE_CACHE_CONTROL)
  async resolve(@Query("canonicalSkuCode") canonicalSkuCode: string, @Query("districtCode") districtCode: string) {
    if (!canonicalSkuCode || !districtCode) {
      throw new NotFoundException("canonicalSkuCode and districtCode are required");
    }

    const [sku, district] = await Promise.all([
      this.prisma.pricingCanonicalSku.findUnique({ where: { code: canonicalSkuCode }, select: { id: true } }),
      this.prisma.pricingDistrict.findUnique({ where: { code: districtCode }, select: { id: true } }),
    ]);
    if (!sku || !district) {
      throw new NotFoundException("Unknown canonicalSkuCode or districtCode");
    }

    const result = await this.resolution.resolveBestAvailablePrice(sku.id, district.id);
    if (result.status === "NO_DATA") {
      return {
        price: null,
        unit: null,
        requestedDistrict: result.requestedDistrict,
        geographyLevel: null,
        state: null,
        district: null,
        fallbackUsed: false,
        fallbackReason: null,
      };
    }

    return {
      price: result.price,
      currency: result.currency,
      unit: result.unit,
      requestedDistrict: result.requestedDistrict,
      geographyLevel: result.geographyLevel,
      state: result.state,
      district: result.district,
      fallbackUsed: result.fallbackUsed,
      fallbackReason: result.fallbackReason,
      confidence: result.confidence,
      method: result.method,
      asOf: result.asOf,
      isStale: result.isStale,
    };
  }

  @Get("district-daily")
  @Header("Cache-Control", NO_STORE_CACHE_CONTROL)
  async getDistrictDaily(
    @Query("canonicalSkuCode") canonicalSkuCode: string,
    @Query("districtCode") districtCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    if (!canonicalSkuCode || !districtCode) {
      throw new NotFoundException("canonicalSkuCode and districtCode are required");
    }

    const [sku, district] = await Promise.all([
      this.prisma.pricingCanonicalSku.findUnique({ where: { code: canonicalSkuCode }, select: { id: true } }),
      this.prisma.pricingDistrict.findUnique({ where: { code: districtCode }, select: { id: true } }),
    ]);
    if (!sku || !district) {
      throw new NotFoundException("Unknown canonicalSkuCode or districtCode");
    }

    const priceDate: Record<string, Date> = {};
    if (from) priceDate.gte = new Date(from);
    if (to) priceDate.lte = new Date(to);

    const rows = await this.prisma.pricingDistrictPriceDaily.findMany({
      where: {
        canonicalSkuId: sku.id,
        districtId: district.id,
        publicDisplayAllowed: true,
        ...(from || to ? { priceDate } : {}),
      },
      orderBy: { priceDate: "desc" },
      take: 366,
      select: {
        priceDate: true,
        medianPerBaseUnit: true,
        p25PerBaseUnit: true,
        p75PerBaseUnit: true,
        minPerBaseUnit: true,
        maxPerBaseUnit: true,
        medianPerDisplayUnit: true,
        displayUnit: true,
        baseUnit: true,
        method: true,
        confidence: true,
        observationCount: true,
        sourceCount: true,
        // Phase 6F: additive geographic metadata (spec §19/§30) — this
        // endpoint is always queried with an explicit districtCode, so
        // every row returned here is DISTRICT-level by construction, but the
        // fields are surfaced explicitly rather than left implicit so
        // callers never have to assume.
        geographyLevel: true,
        stateId: true,
      },
    });

    return { canonicalSkuCode, districtCode, rows };
  }

  @Get("trend-monthly")
  @Header("Cache-Control", NO_STORE_CACHE_CONTROL)
  async getTrendMonthly(@Query("canonicalSkuCode") canonicalSkuCode: string, @Query("districtCode") districtCode: string) {
    if (!canonicalSkuCode || !districtCode) {
      throw new NotFoundException("canonicalSkuCode and districtCode are required");
    }

    const [sku, district] = await Promise.all([
      this.prisma.pricingCanonicalSku.findUnique({ where: { code: canonicalSkuCode }, select: { id: true } }),
      this.prisma.pricingDistrict.findUnique({ where: { code: districtCode }, select: { id: true } }),
    ]);
    if (!sku || !district) {
      throw new NotFoundException("Unknown canonicalSkuCode or districtCode");
    }

    const trendRows = await this.prisma.pricingTrendMonthly.findMany({
      where: { canonicalSkuId: sku.id, districtId: district.id },
      orderBy: { monthStart: "desc" },
      take: 12,
    });
    if (trendRows.length === 0) {
      return { canonicalSkuCode, districtCode, rows: [] };
    }

    // Gate each month on at least one publicly-displayable daily row within
    // that month, since PricingTrendMonthly has no publicDisplayAllowed
    // column of its own.
    type TrendRow = (typeof trendRows)[number];
    const monthBounds = trendRows.map((row: TrendRow) => {
      const start = new Date(row.monthStart);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      return { row, start, end };
    });

    const publicDailyCounts = await Promise.all(
      monthBounds.map(({ start, end }: { start: Date; end: Date }) =>
        this.prisma.pricingDistrictPriceDaily.count({
          where: {
            canonicalSkuId: sku.id,
            districtId: district.id,
            publicDisplayAllowed: true,
            priceDate: { gte: start, lt: end },
          },
        })
      )
    );

    const rows = monthBounds
      .filter((_: unknown, index: number) => publicDailyCounts[index] > 0)
      .map(({ row }: { row: TrendRow }) => ({

        monthStart: row.monthStart,
        medianPerBaseUnit: row.medianPerBaseUnit,
        minPerBaseUnit: row.minPerBaseUnit,
        maxPerBaseUnit: row.maxPerBaseUnit,
        momChangePct: row.momChangePct,
        yoyChangePct: row.yoyChangePct,
        dayCount: row.dayCount,
        confidence: row.confidence,
      }));

    return { canonicalSkuCode, districtCode, rows };
  }
}
