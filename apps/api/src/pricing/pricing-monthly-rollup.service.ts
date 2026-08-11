import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { median, sortNumeric } from "./pricing-stats.util";

/**
 * Rebuilds PricingTrendMonthly for a single calendar month from
 * PricingDistrictPriceDaily rows (never straight from PricingObservation —
 * the daily table is already the deduped/derived source of truth, so this
 * is a pure re-aggregation and is idempotent/safe to re-run).
 *
 * Phase 6F — Geographic Pricing Hierarchy: grouping is scoped to
 * (canonicalSkuId, geographyLevel, stateId, districtId) via geoKey, exactly
 * mirroring the daily rollup. A DISTRICT trend and a STATE trend for the
 * same SKU are always separate PricingTrendMonthly rows — MoM/YoY
 * comparisons only ever look up the previous row within the SAME geography
 * (same geoKey), so "Erode district January" is never compared against
 * "Tamil Nadu state December" (spec §15/§40).
 *
 * momChangePct / yoyChangePct are computed against the immediately
 * preceding month and the same month a year prior, respectively — left null
 * when that comparison month has no row (e.g. the first month of coverage).
 *
 * confidence mirrors the lowest confidence among the day-level rows that
 * contributed (never rounds a LOW-confidence month up to HIGH).
 */
@Injectable()
export class PricingMonthlyRollupService {
  private readonly logger = new Logger(PricingMonthlyRollupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** monthStart must be the first day of the month (UTC midnight). */
  async rollupForMonth(monthStart: Date): Promise<{ rows: number }> {
    const start = new Date(monthStart);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(1);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const dailyRows = await this.prisma.pricingDistrictPriceDaily.findMany({
      where: { priceDate: { gte: start, lt: end } },
    });

    type DailyRow = (typeof dailyRows)[number];
    const byKey = new Map<string, DailyRow[]>();
    for (const row of dailyRows) {
      const key = `${row.canonicalSkuId}::${row.geoKey}`;
      const bucket = byKey.get(key) ?? [];
      bucket.push(row);
      byKey.set(key, bucket);
    }

    const confidenceRank: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    const confidenceByRank = ["LOW", "MEDIUM", "HIGH"] as const;

    let written = 0;

    for (const bucket of byKey.values()) {
      const first = bucket[0];
      const canonicalSkuId = first.canonicalSkuId;
      const geoKey = first.geoKey;
      const geographyLevel = first.geographyLevel;
      const stateId = first.stateId;
      const districtId = first.districtId;

      const values = sortNumeric(bucket.map((r) => Number(r.medianPerBaseUnit)));
      const med = median(values);
      if (med === null) continue;

      const minRank = Math.min(...bucket.map((r) => confidenceRank[r.confidence] ?? 0));
      const confidence = confidenceByRank[minRank];

      const prevMonthStart = new Date(start);
      prevMonthStart.setUTCMonth(prevMonthStart.getUTCMonth() - 1);
      const yearAgoStart = new Date(start);
      yearAgoStart.setUTCFullYear(yearAgoStart.getUTCFullYear() - 1);

      const [prevMonthRow, yearAgoRow] = await Promise.all([
        this.prisma.pricingTrendMonthly.findUnique({
          where: { canonicalSkuId_geoKey_monthStart: { canonicalSkuId, geoKey, monthStart: prevMonthStart } },
        }),
        this.prisma.pricingTrendMonthly.findUnique({
          where: { canonicalSkuId_geoKey_monthStart: { canonicalSkuId, geoKey, monthStart: yearAgoStart } },
        }),
      ]);

      const momChangePct = prevMonthRow
        ? ((med - Number(prevMonthRow.medianPerBaseUnit)) / Number(prevMonthRow.medianPerBaseUnit)) * 100
        : null;
      const yoyChangePct = yearAgoRow
        ? ((med - Number(yearAgoRow.medianPerBaseUnit)) / Number(yearAgoRow.medianPerBaseUnit)) * 100
        : null;

      await this.prisma.pricingTrendMonthly.upsert({
        where: { canonicalSkuId_geoKey_monthStart: { canonicalSkuId, geoKey, monthStart: start } },
        create: {
          canonicalSkuId,
          geographyLevel,
          stateId,
          districtId,
          geoKey,
          monthStart: start,
          medianPerBaseUnit: med,
          minPerBaseUnit: values[0],
          maxPerBaseUnit: values[values.length - 1],
          momChangePct,
          yoyChangePct,
          dayCount: bucket.length,
          confidence,
        },
        update: {
          geographyLevel,
          stateId,
          districtId,
          medianPerBaseUnit: med,
          minPerBaseUnit: values[0],
          maxPerBaseUnit: values[values.length - 1],
          momChangePct,
          yoyChangePct,
          dayCount: bucket.length,
          confidence,
        },
      });
      written++;
    }

    this.logger.log(`rollupForMonth(${start.toISOString().slice(0, 7)}): rows=${written}`);
    return { rows: written };
  }
}
