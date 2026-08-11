import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { median, percentile, sortNumeric } from "./pricing-stats.util";
import { deriveDistrictPrice } from "./pricing-derivation.util";
import { PricingConfigService } from "./pricing-config.service";

/**
 * Rebuilds PricingDistrictPriceDaily for a single priceDate. Idempotent by
 * design (upserts on the [canonicalSkuId, geoKey, priceDate] unique key —
 * Phase 6F replaced the old districtId-only key with geoKey, see schema
 * comment) — safe to re-run for the same date as many times as needed, e.g.
 * after new observations land or an anomaly gets excluded/reinstated.
 *
 * Phase 6F — Geographic Pricing Hierarchy: observations now carry an
 * explicit geographyLevel (DISTRICT/STATE/NATIONAL). Grouping/aggregation
 * happens strictly within one geography — a DISTRICT observation and a
 * STATE observation for the same canonicalSku/day are NEVER merged into one
 * row, even if they happen to share a state (see spec §14). Concretely, the
 * group key is (canonicalSkuId, geographyLevel, stateId, districtId) —
 * three separate rows can exist for the same SKU/day: one DISTRICT row per
 * district, one STATE row, one NATIONAL row.
 *
 * Two passes per (canonicalSku, materialCategory.displayUnit) needed, and
 * BOTH are scoped to DISTRICT-level observations only — STATE/NATIONAL
 * observations never participate in anchor-based derivation, since
 * "deriving Tamil Nadu's state price from Erode's district price" (or vice
 * versa) would violate the same false-precision rule this phase exists to
 * prevent:
 *   Pass 1 (OBSERVED): every district with >=1 non-excluded observation on
 *     priceDate gets a row computed directly from its own observations.
 *     Every STATE/NATIONAL group with >=1 non-excluded observation also
 *     gets an OBSERVED row here, from its own observations only.
 *   Pass 2 (DERIVED_*): every other DISTRICT that has an anchorDistrictId
 *     with an OBSERVED (or already-derived, so derivation can chain once)
 *     row for the same SKU/date gets a row derived via
 *     pricing-derivation.util, using PricingCostIndex + anchorRoadDistanceKm
 *     when available. Districts with no anchor coverage and no derivation
 *     inputs are simply left with no row for that SKU/date — never guessed.
 *     STATE/NATIONAL rows are never derived — there is no "anchor state"
 *     concept, and fabricating one would be exactly the "state price
 *     invented from company address"-style guess this phase prohibits.
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
    // Phase 6F: group key includes geographyLevel + stateId + districtId, so
    // a DISTRICT and a STATE group for the same SKU/day are always distinct
    // buckets — never merged (spec §14).
    const geoGroupKey = (o: { geographyLevel: string; stateId: string | null; districtId: string | null }) =>
      `${o.geographyLevel}::${o.stateId ?? ""}::${o.districtId ?? ""}`;
    const geoKeyFor = (o: { geographyLevel: string; stateId: string | null; districtId: string | null }) =>
      o.geographyLevel === "DISTRICT" ? o.districtId! : o.geographyLevel === "STATE" ? o.stateId! : "NATIONAL";

    const bySkuGeo = new Map<string, Observation[]>();
    for (const obs of observations) {
      const key = `${obs.canonicalSkuId}::${geoGroupKey(obs)}`;
      const bucket = bySkuGeo.get(key) ?? [];
      bucket.push(obs);
      bySkuGeo.set(key, bucket);
    }

    let observedRows = 0;

    // Pass 1: OBSERVED rows, keyed by (canonicalSkuId, geographyLevel, stateId, districtId) -> computed row.
    const observedByKey = new Map<
      string,
      {
        medianPerBaseUnit: number;
        canonicalSkuId: string;
        geographyLevel: "DISTRICT" | "STATE" | "NATIONAL";
        stateId: string | null;
        districtId: string | null;
        baseUnit: string;
        displayUnit: string;
      }
    >();

    for (const bucket of bySkuGeo.values()) {
      const first = bucket[0];
      const canonicalSkuId = first.canonicalSkuId;
      const geographyLevel = first.geographyLevel as "DISTRICT" | "STATE" | "NATIONAL";
      const stateId = first.stateId;
      const districtId = first.districtId;
      const geoKey = geoKeyFor(first);

      const values = sortNumeric(bucket.map((o) => Number(o.pricePerBaseUnit)));
      const med = median(values);
      if (med === null) continue;

      const category = first.canonicalSku.materialCategory;
      const contributingSourceCodes = Array.from(new Set(bucket.map((o) => o.source.code)));
      const publicDisplayAllowed = bucket.every((o) => o.source.publicDisplayAllowed);

      await this.prisma.pricingDistrictPriceDaily.upsert({
        where: { canonicalSkuId_geoKey_priceDate: { canonicalSkuId, geoKey, priceDate: startOfDay } },
        create: {
          canonicalSkuId,
          geographyLevel,
          stateId,
          districtId,
          geoKey,
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
          geographyLevel,
          stateId,
          districtId,
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

      observedByKey.set(`${canonicalSkuId}::${geoGroupKey(first)}`, {
        medianPerBaseUnit: med,
        canonicalSkuId,
        geographyLevel,
        stateId,
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

      // Pass 2 is DISTRICT-only (spec §14/§15): derivation never applies to
      // STATE/NATIONAL groups — there is no "anchor state" concept, so the
      // key format below always encodes geographyLevel=DISTRICT explicitly.
      for (const canonicalSkuId of canonicalSkuIds) {
        for (const district of districts) {
          const key = `${canonicalSkuId}::DISTRICT::${district.stateId}::${district.id}`;
          if (observedByKey.has(key)) continue; // already has a direct observation
          if (!district.anchorDistrictId) continue; // this district is itself an anchor; no fallback available

          const anchor = districtById.get(district.anchorDistrictId);
          const anchorKey = `${canonicalSkuId}::DISTRICT::${anchor?.stateId ?? ""}::${district.anchorDistrictId}`;
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
              canonicalSkuId_geoKey_priceDate: { canonicalSkuId, geoKey: district.id, priceDate: startOfDay },
            },
            create: {
              canonicalSkuId,
              geographyLevel: "DISTRICT",
              stateId: district.stateId,
              districtId: district.id,
              geoKey: district.id,
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
              geographyLevel: "DISTRICT",
              stateId: district.stateId,
              districtId: district.id,
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
