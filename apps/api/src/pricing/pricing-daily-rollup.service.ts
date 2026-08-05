import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { median, percentile, sortNumeric } from "./pricing-stats.util";
import { deriveDistrictPrice } from "./pricing-derivation.util";
import { PricingConfigService } from "./pricing-config.service";

/**
 * Rebuilds PricingDistrictPriceDaily for a single priceDate. Idempotent by
 * design (upserts on the [canonicalSkuId, districtId, priceDate] unique
 * key) — safe to re-run for the same date as many times as needed, e.g.
 * after new observations land or an anomaly gets excluded/reinstated.
 *
 * Two passes per (canonicalSku, materialCategory.displayUnit) needed:
 *   Pass 1 (OBSERVED): every district with >=1 non-excluded observation on
 *     priceDate gets a row computed directly from its own observations.
 *   Pass 2 (DERIVED_*): every other district that has an anchorDistrictId
 *     with an OBSERVED (or already-derived, so derivation can chain once)
 *     row for the same SKU/date gets a row derived via
 *     pricing-derivation.util, using PricingCostIndex + anchorRoadDistanceKm
 *     when available. Districts with no anchor coverage and no derivation
 *     inputs are simply left with no row for that SKU/date — never guessed.
 *
 * publicDisplayAllowed on the output row is true only if every contributing
 * source's licenseClass allows public display (source.publicDisplayAllowed).
 */
@Injectable()
export class PricingDailyRollupService {
  private readonly logger = new Logger(PricingDailyRollupService.name);

  constructor(private readonly prisma: PrismaService, private readonly config: PricingConfigService) {}

  async rollupForDate(priceDate: Date): Promise<{ observedRows: number; derivedRows: number }> {
    const startOfDay = new Date(priceDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    const observations = await this.prisma.pricingObservation.findMany({
      where: { isExcluded: false, fetchedAt: { gte: startOfDay, lt: endOfDay } },
      include: { source: true, canonicalSku: { include: { materialCategory: true } } },
    });

    type Observation = (typeof observations)[number];
    const bySkuDistrict = new Map<string, Observation[]>();
    for (const obs of observations) {
      const key = `${obs.canonicalSkuId}::${obs.districtId}`;
      const bucket = bySkuDistrict.get(key) ?? [];
      bucket.push(obs);
      bySkuDistrict.set(key, bucket);
    }

    let observedRows = 0;

    // Pass 1: OBSERVED rows, keyed by (canonicalSkuId, districtId) -> computed row.
    const observedByKey = new Map<
      string,
      { medianPerBaseUnit: number; canonicalSkuId: string; districtId: string; baseUnit: string; displayUnit: string }
    >();

    for (const [key, bucket] of bySkuDistrict.entries()) {
      const [canonicalSkuId, districtId] = key.split("::");
      const values = sortNumeric(bucket.map((o) => Number(o.pricePerBaseUnit)));
      const med = median(values);
      if (med === null) continue;

      const category = bucket[0].canonicalSku.materialCategory;
      const contributingSourceCodes = Array.from(new Set(bucket.map((o) => o.source.code)));
      const publicDisplayAllowed = bucket.every((o) => o.source.publicDisplayAllowed);

      await this.prisma.pricingDistrictPriceDaily.upsert({
        where: { canonicalSkuId_districtId_priceDate: { canonicalSkuId, districtId, priceDate: startOfDay } },
        create: {
          canonicalSkuId,
          districtId,
          priceDate: startOfDay,
          baseUnit: bucket[0].baseUnit,
          medianPerBaseUnit: med,
          p25PerBaseUnit: percentile(values, 0.25),
          p75PerBaseUnit: percentile(values, 0.75),
          minPerBaseUnit: values[0],
          maxPerBaseUnit: values[values.length - 1],
          displayUnit: category.displayUnit,
          observationCount: bucket.length,
          sourceCount: contributingSourceCodes.length,
          method: "OBSERVED",
          confidence: bucket.length >= 3 ? "HIGH" : bucket.length === 2 ? "MEDIUM" : "LOW",
          publicDisplayAllowed,
          contributingSourceCodes,
        },
        update: {
          baseUnit: bucket[0].baseUnit,
          medianPerBaseUnit: med,
          p25PerBaseUnit: percentile(values, 0.25),
          p75PerBaseUnit: percentile(values, 0.75),
          minPerBaseUnit: values[0],
          maxPerBaseUnit: values[values.length - 1],
          displayUnit: category.displayUnit,
          observationCount: bucket.length,
          sourceCount: contributingSourceCodes.length,
          method: "OBSERVED",
          confidence: bucket.length >= 3 ? "HIGH" : bucket.length === 2 ? "MEDIUM" : "LOW",
          publicDisplayAllowed,
          contributingSourceCodes,
          anchorDistrictId: null,
          derivationJson: Prisma.JsonNull,
        },
      });

      observedByKey.set(key, {
        medianPerBaseUnit: med,
        canonicalSkuId,
        districtId,
        baseUnit: bucket[0].baseUnit,
        displayUnit: category.displayUnit,
      });
      observedRows++;
    }

    // Pass 2: DERIVED_* rows for districts with no direct observation, one
    // hop from an anchor that DOES have an OBSERVED row for the same SKU.
    let derivedRows = 0;
    const freightRateEnv = process.env.PRICING_FREIGHT_RATE_PER_KM_PER_BASE_UNIT;
    const freightRatePerKmPerBaseUnit = freightRateEnv ? Number(freightRateEnv) : null;

    const canonicalSkuIds = Array.from(new Set(Array.from(observedByKey.values()).map((v) => v.canonicalSkuId)));
    if (canonicalSkuIds.length > 0) {
      const districts = await this.prisma.pricingDistrict.findMany({});
      type District = (typeof districts)[number];
      const districtById = new Map(districts.map((d: District) => [d.id, d] as const));

      // Nearest-quarter cost index lookup, cached per centreCode for this run.
      const costIndexCache = new Map<string, { quarterEndsOn: Date; materialIndex: number } | null>();
      const getLatestCostIndex = async (centreCode: string | null) => {
        if (!centreCode) return null;
        if (costIndexCache.has(centreCode)) return costIndexCache.get(centreCode) ?? null;
        const row = await this.prisma.pricingCostIndex.findFirst({
          where: { centreCode, quarterEndsOn: { lte: startOfDay } },
          orderBy: { quarterEndsOn: "desc" },
        });
        const result = row ? { quarterEndsOn: row.quarterEndsOn, materialIndex: Number(row.materialIndex) } : null;
        costIndexCache.set(centreCode, result);
        return result;
      };

      for (const canonicalSkuId of canonicalSkuIds) {
        for (const district of districts) {
          const key = `${canonicalSkuId}::${district.id}`;
          if (observedByKey.has(key)) continue; // already has a direct observation
          if (!district.anchorDistrictId) continue; // this district is itself an anchor; no fallback available

          const anchorKey = `${canonicalSkuId}::${district.anchorDistrictId}`;
          const anchorRow = observedByKey.get(anchorKey);
          if (!anchorRow) continue; // anchor has no OBSERVED row for this SKU/date either — leave unserved, not guessed

          const anchorDistrict = districtById.get(district.anchorDistrictId);
          const [districtIndex, anchorIndex] = await Promise.all([
            getLatestCostIndex(district.desCentreCode),
            getLatestCostIndex(anchorDistrict?.desCentreCode ?? null),
          ]);

          const derivation = deriveDistrictPrice({
            anchorMedianPerBaseUnit: anchorRow.medianPerBaseUnit,
            districtCostIndex: districtIndex?.materialIndex ?? null,
            anchorCostIndex: anchorIndex?.materialIndex ?? null,
            anchorRoadDistanceKm: district.anchorRoadDistanceKm,
            freightRatePerKmPerBaseUnit,
            sorAreaSupplementPct: district.sorAreaSupplementPct ? Number(district.sorAreaSupplementPct) : null,
          });

          if (!derivation) continue; // no verifiable derivation input available — do not fabricate

          await this.prisma.pricingDistrictPriceDaily.upsert({
            where: {
              canonicalSkuId_districtId_priceDate: { canonicalSkuId, districtId: district.id, priceDate: startOfDay },
            },
            create: {
              canonicalSkuId,
              districtId: district.id,
              priceDate: startOfDay,
              baseUnit: anchorRow.baseUnit as any,
              medianPerBaseUnit: derivation.value,
              displayUnit: anchorRow.displayUnit as any,
              observationCount: 0,
              sourceCount: 0,
              method: derivation.method,
              confidence: "LOW",
              anchorDistrictId: district.anchorDistrictId,
              derivationJson: derivation.derivationJson as any,
              publicDisplayAllowed: false, // derived figures are benchmarking-only until explicitly reviewed
              contributingSourceCodes: [],
            },
            update: {
              baseUnit: anchorRow.baseUnit as any,
              medianPerBaseUnit: derivation.value,
              displayUnit: anchorRow.displayUnit as any,
              observationCount: 0,
              sourceCount: 0,
              method: derivation.method,
              confidence: "LOW",
              anchorDistrictId: district.anchorDistrictId,
              derivationJson: derivation.derivationJson as any,
              publicDisplayAllowed: false,
              contributingSourceCodes: [],
            },
          });
          derivedRows++;
        }
      }
    }

    this.logger.log(
      `rollupForDate(${startOfDay.toISOString().slice(0, 10)}): observedRows=${observedRows} derivedRows=${derivedRows}`
    );
    return { observedRows, derivedRows };
  }
}
