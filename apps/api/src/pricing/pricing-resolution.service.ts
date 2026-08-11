import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

/**
 * Phase 6F — Geographic Pricing Hierarchy price-resolution service.
 *
 * Implements the DISTRICT > STATE > NATIONAL fallback precedence described
 * in docs/pricing/geographic-pricing-hierarchy.md. This is the ONE place
 * that hierarchy precedence should be evaluated — callers (public API,
 * Builder district-pricing route, watchlist bridge, alert engine) should
 * all funnel through resolveBestAvailablePrice() rather than re-implementing
 * the fallback logic independently, so a future precedence-rule change only
 * needs to happen here.
 *
 * Resolution order (spec §16/§23/§24):
 *   1. Find a valid DISTRICT price for the requested district.
 *   2. If none, find a valid STATE price for that district's state.
 *   3. If none, find a valid NATIONAL price.
 *   4. If none, return NO_DATA.
 *
 * "Valid" means, at every level:
 *   - publicDisplayAllowed = true (compliance gate — an INTERNAL_ONLY-tainted
 *     row is skipped at that level even if it is more geographically
 *     precise; spec §24: never let precision bypass compliance)
 *   - not stale beyond STALE_THRESHOLD_HOURS (spec §22 — reuses the exact
 *     same 72h/3-day threshold as the existing alert-eligibility rule so
 *     resolution and alerting never disagree about what counts as fresh)
 *
 * A single indexed query per geography level (at most 3 total) is used —
 * no N+1 fan-out (spec §41).
 */

const STALE_THRESHOLD_HOURS = 24 * 3;

export type PriceResolutionResult =
  | {
      status: "RESOLVED";
      price: number;
      currency: string;
      unit: string;
      geographyLevel: "DISTRICT" | "STATE" | "NATIONAL";
      state: string | null;
      district: string | null;
      requestedDistrict: string | null;
      confidence: string;
      method: string;
      asOf: string;
      isStale: boolean;
      fallbackUsed: boolean;
      fallbackReason: "NO_DISTRICT_PRICE_AVAILABLE" | "NO_STATE_PRICE_AVAILABLE" | null;
    }
  | {
      status: "NO_DATA";
      requestedDistrict: string | null;
      fallbackUsed: false;
      fallbackReason: null;
    };

@Injectable()
export class PricingResolutionService {
  private readonly logger = new Logger(PricingResolutionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the best available price for a canonical SKU + district,
   * applying DISTRICT > STATE > NATIONAL precedence. `asOfDate` defaults to
   * "now" (latest available row at or before now, per level).
   */
  async resolveBestAvailablePrice(
    canonicalSkuId: string,
    districtId: string,
    asOfDate: Date = new Date()
  ): Promise<PriceResolutionResult> {
    const district = await this.prisma.pricingDistrict.findUnique({
      where: { id: districtId },
      select: { id: true, name: true, stateId: true, state: { select: { id: true, name: true } } },
    });

    const requestedDistrictName = district?.name ?? null;

    // 1. DISTRICT
    const districtRow = await this.findValidRow(canonicalSkuId, { geographyLevel: "DISTRICT", districtId }, asOfDate);
    if (districtRow) {
      return this.toResolved(districtRow, requestedDistrictName, false, null);
    }

    // 2. STATE (only meaningful if we know the district's state)
    if (district?.stateId) {
      const stateRow = await this.findValidRow(canonicalSkuId, { geographyLevel: "STATE", stateId: district.stateId }, asOfDate);
      if (stateRow) {
        return this.toResolved(stateRow, requestedDistrictName, true, "NO_DISTRICT_PRICE_AVAILABLE");
      }
    }

    // 3. NATIONAL
    const nationalRow = await this.findValidRow(canonicalSkuId, { geographyLevel: "NATIONAL" }, asOfDate);
    if (nationalRow) {
      return this.toResolved(nationalRow, requestedDistrictName, true, "NO_STATE_PRICE_AVAILABLE");
    }

    // 4. NO_DATA
    return { status: "NO_DATA", requestedDistrict: requestedDistrictName, fallbackUsed: false, fallbackReason: null };
  }

  private async findValidRow(
    canonicalSkuId: string,
    geo: { geographyLevel: "DISTRICT"; districtId: string } | { geographyLevel: "STATE"; stateId: string } | { geographyLevel: "NATIONAL" },
    asOfDate: Date
  ) {
    const staleCutoff = new Date(asOfDate.getTime() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);

    return this.prisma.pricingDistrictPriceDaily.findFirst({
      where: {
        canonicalSkuId,
        geographyLevel: geo.geographyLevel,
        ...(geo.geographyLevel === "DISTRICT" ? { districtId: geo.districtId } : {}),
        ...(geo.geographyLevel === "STATE" ? { stateId: geo.stateId } : {}),
        ...(geo.geographyLevel === "NATIONAL" ? { stateId: null, districtId: null } : {}),
        priceDate: { lte: asOfDate, gte: staleCutoff },
        publicDisplayAllowed: true,
      },
      orderBy: { priceDate: "desc" },
      include: { state: { select: { name: true } }, district: { select: { name: true } } },
    });
  }

  private toResolved(
    row: Awaited<ReturnType<PricingResolutionService["findValidRow"]>>,
    requestedDistrict: string | null,
    fallbackUsed: boolean,
    fallbackReason: "NO_DISTRICT_PRICE_AVAILABLE" | "NO_STATE_PRICE_AVAILABLE" | null
  ): PriceResolutionResult {
    if (!row) {
      return { status: "NO_DATA", requestedDistrict, fallbackUsed: false, fallbackReason: null };
    }
    const isStale = new Date().getTime() - row.priceDate.getTime() > STALE_THRESHOLD_HOURS * 60 * 60 * 1000;
    return {
      status: "RESOLVED",
      price: Number(row.medianPerBaseUnit),
      currency: "INR",
      unit: row.displayUnit ?? row.baseUnit,
      geographyLevel: row.geographyLevel as "DISTRICT" | "STATE" | "NATIONAL",
      state: row.state?.name ?? null,
      district: row.district?.name ?? null,
      requestedDistrict,
      confidence: row.confidence,
      method: row.method,
      asOf: row.priceDate.toISOString().slice(0, 10),
      isStale,
      fallbackUsed,
      fallbackReason,
    };
  }
}
