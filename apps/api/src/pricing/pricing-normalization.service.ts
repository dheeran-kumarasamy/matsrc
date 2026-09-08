import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

/**
 * Phase 6F — explicit geographic context a caller must supply for a
 * normalizeBatch() run. Deliberately NOT inferred inside this service from
 * rawLocationText, source company address, or any other heuristic (see
 * docs/pricing/geographic-pricing-hierarchy.md "What is prohibited") — the
 * caller (ingestion/admin-ops layer) must already know, from source-declared
 * applicability, which of these three shapes is correct for the batch it is
 * normalizing:
 *
 *   { geographyLevel: "DISTRICT", districtId: "<id>" }
 *   { geographyLevel: "STATE", stateId: "<id>" }
 *   { geographyLevel: "NATIONAL" }
 *
 * There is deliberately no "UNRESOLVED" member here — if geography cannot
 * be determined for a batch, the caller must not call normalizeBatch() for
 * that batch at all; the raw rows are simply left PENDING (mirrors the
 * existing pre-Phase-6F contract where normalizeBatch() already required an
 * explicit districtId with no fallback).
 */
export type NormalizationGeographyContext =
  | { geographyLevel: "DISTRICT"; districtId: string }
  | { geographyLevel: "STATE"; stateId: string }
  | { geographyLevel: "NATIONAL" };

/**
 * Turns PENDING PricingRawObservation rows into PricingObservation rows.
 *
 * Pipeline per raw row:
 *   1. Resolve rawSkuLabel -> PricingCanonicalSku via PricingSkuAlias
 *      (EXACT match on normalizedLabel scoped to the source; anything else
 *      is out of scope for this first cut — FUZZY/embedding matching is a
 *      later-phase concern per the confirmed Phase 2 boundary
 *      "normalization/fingerprint matching" meaning exact+alias resolution,
 *      not a full fuzzy-matching engine).
 *   2. If unresolved, create/increment a PricingSkuAlias row with
 *      canonicalSkuId=null (admin triage queue, per schema comment) and
 *      mark parseStatus=UNMAPPED.
 *   3. If resolved, look up a PricingUnitConversion for the parsed unit
 *      text; if none found or the row isAmbiguous, mark QUARANTINED rather
 *      than guessing (never fabricate a conversion factor).
 *   4. Parse rawPriceText into a numeric price; unparseable => REJECTED.
 *   5. Compute pricePerBaseUnit, write the PricingObservation (stamped with
 *      the caller-supplied geography — see NormalizationGeographyContext),
 *      mark parseStatus=PARSED.
 *
 * This never mutates PricingRawObservation.payload — only parseStatus (and,
 * once we resolve an observation, the one-to-one `observation` relation).
 */
@Injectable()
export class PricingNormalizationService {
  private readonly logger = new Logger(PricingNormalizationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Safe Phase 2 endpoint-scoped normalization: processes PENDING raw
   * observations belonging strictly to `endpointId`, using only that
   * endpoint's trusted geography configuration (geographyLevel, stateId,
   * districtId). Eliminates multi-source geography contamination risk.
   */
  /**
   * Safe Phase 2 endpoint-scoped normalization: processes PENDING raw
   * observations belonging strictly to `endpointId`, using only that
   * endpoint's trusted geography configuration (geographyLevel, stateId,
   * districtId). Eliminates multi-source geography contamination risk.
   *
   * Optimized: pre-fetches source, SKU aliases, canonical SKUs, unit conversions,
   * and geography fields once per batch to eliminate N+1 per-row DB round-trips.
   */
  async normalizeEndpoint(
    endpointId: string,
    limit = 100
  ): Promise<{ processed: number; parsed: number; unmapped: number; quarantined: number; rejected: number }> {
    const tStart = performance.now();
    const endpoint = await this.prisma.pricingSourceEndpoint.findUnique({
      where: { id: endpointId },
      include: { source: true, state: true, district: true },
    });

    if (!endpoint) {
      throw new Error(`PricingSourceEndpoint "${endpointId}" not found.`);
    }

    const tFetchPendingStart = performance.now();
    const pending = await this.prisma.pricingRawObservation.findMany({
      where: {
        sourceId: endpoint.sourceId,
        sourceUrl: endpoint.url,
        parseStatus: "PENDING",
      },
      take: limit,
      orderBy: { fetchedAt: "asc" },
    });

    if (pending.length === 0) {
      return { processed: 0, parsed: 0, unmapped: 0, quarantined: 0, rejected: 0 };
    }

    // Validate trusted endpoint geography configuration
    const context = this.getEndpointGeographyContext(endpoint);
    if (!context) {
      // Endpoint geography is missing or invalid — quarantine all raw rows rather than guess
      let quarantinedCount = 0;
      for (const raw of pending) {
        await this.markStatus(
          raw.id,
          "QUARANTINED",
          "Endpoint geography is not configured or is invalid (requires explicit geographyLevel and valid stateId/districtId)"
        );
        quarantinedCount++;
      }
      this.logger.warn(`normalizeEndpoint: endpointId=${endpointId} quarantined ${quarantinedCount} row(s) due to missing endpoint geography`);
      return { processed: pending.length, parsed: 0, unmapped: 0, quarantined: quarantinedCount, rejected: 0 };
    }

    const tBatchContextStart = performance.now();
    const batchContext = await this.buildBatchContext(pending, context);
    const tBatchContextEnd = performance.now();

    let parsed = 0;
    let unmapped = 0;
    let quarantined = 0;
    let rejected = 0;

    const tLoopStart = performance.now();
    for (const raw of pending) {
      try {
        const outcome = await this.normalizeOne(raw, context, batchContext);
        if (outcome === "PARSED") parsed++;
        else if (outcome === "UNMAPPED") unmapped++;
        else if (outcome === "QUARANTINED") quarantined++;
        else rejected++;
      } catch (err) {
        this.logger.error(`normalizeEndpoint: failed processing raw observation ${raw.id}`, err instanceof Error ? err.stack : String(err));
        rejected++;
      }
    }
    const tLoopEnd = performance.now();
    const totalMs = (performance.now() - tStart).toFixed(1);
    const batchContextMs = (tBatchContextEnd - tBatchContextStart).toFixed(1);
    const loopMs = (tLoopEnd - tLoopStart).toFixed(1);
    const avgRowMs = pending.length > 0 ? ((tLoopEnd - tLoopStart) / pending.length).toFixed(1) : "0.0";

    this.logger.log(
      `normalizeEndpoint: endpointId=${endpointId} geographyLevel=${context.geographyLevel} processed=${pending.length} parsed=${parsed} unmapped=${unmapped} quarantined=${quarantined} rejected=${rejected} timing={totalMs:${totalMs}, batchContextMs:${batchContextMs}, rowsLoopMs:${loopMs}, avgRowMs:${avgRowMs}}`
    );

    return { processed: pending.length, parsed, unmapped, quarantined, rejected };
  }

  /**
   * Normalizes all PENDING raw observations for a given PricingSource by
   * iterating through each of its endpoints independently with their respective
   * trusted geography contexts.
   */
  async normalizeSource(
    sourceId: string,
    limit = 100
  ): Promise<{ processed: number; parsed: number; unmapped: number; quarantined: number; rejected: number }> {
    const endpoints = await this.prisma.pricingSourceEndpoint.findMany({
      where: { sourceId },
      select: { id: true },
    });

    let totalProcessed = 0;
    let totalParsed = 0;
    let totalUnmapped = 0;
    let totalQuarantined = 0;
    let totalRejected = 0;

    for (const endpoint of endpoints) {
      const res = await this.normalizeEndpoint(endpoint.id, limit);
      totalProcessed += res.processed;
      totalParsed += res.parsed;
      totalUnmapped += res.unmapped;
      totalQuarantined += res.quarantined;
      totalRejected += res.rejected;
    }

    return {
      processed: totalProcessed,
      parsed: totalParsed,
      unmapped: totalUnmapped,
      quarantined: totalQuarantined,
      rejected: totalRejected,
    };
  }

  /**
   * Validates and shapes an endpoint's DB fields into NormalizationGeographyContext.
   * Enforces DB CHECK constraints:
   *   DISTRICT  -> stateId NOT NULL, districtId NOT NULL
   *   STATE     -> stateId NOT NULL, districtId NULL
   *   NATIONAL  -> stateId NULL, districtId NULL
   */
  private getEndpointGeographyContext(endpoint: {
    geographyLevel: "DISTRICT" | "STATE" | "NATIONAL" | null;
    stateId: string | null;
    districtId: string | null;
    district?: { stateId: string } | null;
  }): NormalizationGeographyContext | null {
    if (!endpoint.geographyLevel) return null;

    if (endpoint.geographyLevel === "NATIONAL") {
      if (endpoint.stateId !== null || endpoint.districtId !== null) return null;
      return { geographyLevel: "NATIONAL" };
    }

    if (endpoint.geographyLevel === "STATE") {
      if (!endpoint.stateId || endpoint.districtId !== null) return null;
      return { geographyLevel: "STATE", stateId: endpoint.stateId };
    }

    if (endpoint.geographyLevel === "DISTRICT") {
      if (!endpoint.districtId) return null;
      const stateId = endpoint.stateId || endpoint.district?.stateId;
      if (!stateId) return null;
      return { geographyLevel: "DISTRICT", districtId: endpoint.districtId };
    }

    return null;
  }

  /**
   * Processes up to `limit` PENDING raw observations, stamping every
   * resulting PricingObservation with the explicit `geography` the caller
   * provides. Kept for backward compatibility in test suites.
   */
  async normalizeBatch(
    geography: NormalizationGeographyContext | string,
    limit = 100
  ): Promise<{ processed: number; parsed: number; unmapped: number; quarantined: number; rejected: number }> {
    const context: NormalizationGeographyContext =
      typeof geography === "string" ? { geographyLevel: "DISTRICT", districtId: geography } : geography;

    const pending = await this.prisma.pricingRawObservation.findMany({
      where: { parseStatus: "PENDING" },
      take: limit,
      orderBy: { fetchedAt: "asc" },
    });

    if (pending.length === 0) {
      return { processed: 0, parsed: 0, unmapped: 0, quarantined: 0, rejected: 0 };
    }

    const batchContext = await this.buildBatchContext(pending, context);

    let parsed = 0;
    let unmapped = 0;
    let quarantined = 0;
    let rejected = 0;

    for (const raw of pending) {
      try {
        const outcome = await this.normalizeOne(raw, context, batchContext);
        if (outcome === "PARSED") parsed++;
        else if (outcome === "UNMAPPED") unmapped++;
        else if (outcome === "QUARANTINED") quarantined++;
        else rejected++;
      } catch (err) {
        this.logger.error(`normalizeBatch: failed processing raw observation ${raw.id}`, err instanceof Error ? err.stack : String(err));
        rejected++;
      }
    }

    this.logger.log(
      `normalizeBatch: geographyLevel=${context.geographyLevel} processed=${pending.length} parsed=${parsed} unmapped=${unmapped} quarantined=${quarantined} rejected=${rejected}`
    );

    return { processed: pending.length, parsed, unmapped, quarantined, rejected };
  }

  /**
   * Batch pre-fetches source metadata, SKU aliases, canonical SKUs, unit conversions,
   * and geography fields in memory once per batch to eliminate N+1 per-row DB round-trips.
   */
  private async buildBatchContext(
    pending: { id: string; sourceId: string; rawSkuLabel: string | null; rawUnitText: string | null }[],
    geography: NormalizationGeographyContext
  ) {
    const sourceIds = Array.from(new Set(pending.map((r) => r.sourceId).filter(Boolean)));
    const sources = sourceIds.length > 0
      ? await this.prisma.pricingSource.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, code: true, defaultTaxTreatment: true },
        })
      : [];
    const sourceMap = new Map(sources.map((s) => [s.id, s]));

    const geographyFields = await this.resolveGeographyFields(geography);

    // Pre-fetch SKU Aliases
    const rawLabels = Array.from(new Set(pending.map((r) => r.rawSkuLabel).filter((l): l is string => Boolean(l))));
    const aliasMap = new Map<string, any>();

    if (rawLabels.length > 0 && sourceIds.length > 0) {
      const existingAliases = await this.prisma.pricingSkuAlias.findMany({
        where: {
          sourceId: { in: sourceIds },
          rawLabel: { in: rawLabels },
        },
      });

      for (const alias of existingAliases) {
        if (alias.sourceId) {
          aliasMap.set(`${alias.sourceId}:${alias.rawLabel}`, alias);
        }
      }

      // Handle rawLabels that do not exist yet in SKU Aliases
      for (const raw of pending) {
        if (!raw.rawSkuLabel) continue;
        const key = `${raw.sourceId}:${raw.rawSkuLabel}`;
        if (!aliasMap.has(key)) {
          const normalizedLabel = this.normalizeLabel(raw.rawSkuLabel);
          let alias = await this.prisma.pricingSkuAlias.findUnique({
            where: { sourceId_rawLabel: { sourceId: raw.sourceId, rawLabel: raw.rawSkuLabel } },
          });
          if (!alias) {
            alias = await this.prisma.pricingSkuAlias.create({
              data: {
                sourceId: raw.sourceId,
                rawLabel: raw.rawSkuLabel,
                normalizedLabel,
                canonicalSkuId: null,
                matchType: "EXACT",
                occurrenceCount: 1,
              },
            });
          } else {
            await this.prisma.pricingSkuAlias.update({
              where: { id: alias.id },
              data: { occurrenceCount: alias.occurrenceCount + 1 },
            });
          }
          aliasMap.set(key, alias);
        } else {
          // Increment occurrenceCount in DB and memory
          const alias = aliasMap.get(key);
          await this.prisma.pricingSkuAlias.update({
            where: { id: alias.id },
            data: { occurrenceCount: alias.occurrenceCount + 1 },
          });
          alias.occurrenceCount += 1;
        }
      }
    }

    // Pre-fetch Canonical SKUs
    const canonicalSkuIds = Array.from(
      new Set(Array.from(aliasMap.values()).map((a) => a.canonicalSkuId).filter((id): id is string => Boolean(id)))
    );
    const canonicalSkus = canonicalSkuIds.length > 0
      ? await this.prisma.pricingCanonicalSku.findMany({
          where: { id: { in: canonicalSkuIds } },
        })
      : [];
    const canonicalSkuMap = new Map(canonicalSkus.map((s) => [s.id, s]));

    // Pre-fetch Unit Conversions
    const categoryIds = Array.from(new Set(canonicalSkus.map((s) => s.materialCategoryId).filter(Boolean)));
    const unitLabels = Array.from(
      new Set(pending.map((r) => (r.rawUnitText ?? "").trim().toLowerCase()).filter((u) => u.length > 0))
    );
    const unitConversionMap = new Map<string, any>();

    if (categoryIds.length > 0 && unitLabels.length > 0) {
      const conversions = await this.prisma.pricingUnitConversion.findMany({
        where: {
          materialCategoryId: { in: categoryIds },
          fromLabel: { in: unitLabels },
        },
      });
      for (const conv of conversions) {
        if (conv.materialCategoryId) {
          unitConversionMap.set(`${conv.materialCategoryId}:${conv.fromLabel}`, conv);
        }
      }
    }

    return {
      sourceMap,
      geographyFields,
      aliasMap,
      canonicalSkuMap,
      unitConversionMap,
    };
  }

  private async normalizeOne(
    raw: { id: string; sourceId: string; rawSkuLabel: string | null; rawPriceText: string | null; rawUnitText: string | null; rawAsOfText: string | null },
    geography: NormalizationGeographyContext,
    batchContext?: {
      sourceMap: Map<string, any>;
      geographyFields: { geographyLevel: "DISTRICT" | "STATE" | "NATIONAL"; stateId: string | null; districtId: string | null } | null;
      aliasMap: Map<string, any>;
      canonicalSkuMap: Map<string, any>;
      unitConversionMap: Map<string, any>;
    }
  ): Promise<"PARSED" | "UNMAPPED" | "QUARANTINED" | "REJECTED"> {
    if (!raw.rawSkuLabel || !raw.rawPriceText) {
      await this.markStatus(raw.id, "REJECTED", "Missing rawSkuLabel or rawPriceText");
      return "REJECTED";
    }

    const key = `${raw.sourceId}:${raw.rawSkuLabel}`;
    let alias = batchContext?.aliasMap.get(key);

    if (!alias) {
      const normalizedLabel = this.normalizeLabel(raw.rawSkuLabel);
      alias = await this.prisma.pricingSkuAlias.findUnique({
        where: { sourceId_rawLabel: { sourceId: raw.sourceId, rawLabel: raw.rawSkuLabel } },
      });

      if (!alias) {
        alias = await this.prisma.pricingSkuAlias.create({
          data: {
            sourceId: raw.sourceId,
            rawLabel: raw.rawSkuLabel,
            normalizedLabel,
            canonicalSkuId: null,
            matchType: "EXACT",
            occurrenceCount: 1,
          },
        });
      } else {
        await this.prisma.pricingSkuAlias.update({
          where: { id: alias.id },
          data: { occurrenceCount: alias.occurrenceCount + 1 },
        });
      }
    }

    if (!alias.canonicalSkuId) {
      await this.markStatus(raw.id, "UNMAPPED", "No canonicalSkuId on alias — queued for admin triage");
      return "UNMAPPED";
    }

    let canonicalSku = batchContext?.canonicalSkuMap.get(alias.canonicalSkuId);
    if (!canonicalSku) {
      canonicalSku = await this.prisma.pricingCanonicalSku.findUnique({
        where: { id: alias.canonicalSkuId },
      });
    }

    if (!canonicalSku) {
      await this.markStatus(raw.id, "UNMAPPED", "Alias points at a canonicalSkuId that no longer exists");
      return "UNMAPPED";
    }

    const price = this.parsePriceText(raw.rawPriceText);
    if (price === null) {
      await this.markStatus(raw.id, "REJECTED", `Unparseable rawPriceText: "${raw.rawPriceText}"`);
      return "REJECTED";
    }

    let source = batchContext?.sourceMap.get(raw.sourceId);
    if (!source) {
      source = await this.prisma.pricingSource.findUnique({
        where: { id: raw.sourceId },
        select: { code: true, defaultTaxTreatment: true },
      });
    }

    const unitLabel = (raw.rawUnitText ?? "").trim().toLowerCase();
    let conversionFactor: number | null = null;
    let conversionBaseUnit: "KG" | "TONNE" | "CFT" | "CUM" | "PIECE" | "SQFT" | "LITRE" | "RFT" | "BAG" = canonicalSku.baseUnit;

    // Narrowly scoped, source-backed conversion rule for JINDAL_PANTHER 12m fixed length piece TMT bars
    if (source?.code === "JINDAL_PANTHER" && (unitLabel === "per piece" || unitLabel === "piece")) {
      if (canonicalSku.baseUnit !== "KG") {
        await this.markStatus(
          raw.id,
          "QUARANTINED",
          `Jindal Panther piece conversion expects canonical SKU baseUnit KG, got ${canonicalSku.baseUnit}`
        );
        return "QUARANTINED";
      }

      const specJson = canonicalSku.specJson as { nominalWeightKgPerMeter?: number } | null;
      const nominalWeight = specJson?.nominalWeightKgPerMeter;

      if (typeof nominalWeight !== "number" || nominalWeight <= 0 || !Number.isFinite(nominalWeight)) {
        await this.markStatus(
          raw.id,
          "QUARANTINED",
          "Missing or invalid nominalWeightKgPerMeter on canonicalSku specJson for Jindal Panther 12m piece conversion"
        );
        return "QUARANTINED";
      }

      // Jindal Panther published rate table explicitly specifies 12m fixed length for TMT rebar pieces
      const JINDAL_PANTHER_FIXED_PIECE_LENGTH_METERS = 12;
      conversionFactor = JINDAL_PANTHER_FIXED_PIECE_LENGTH_METERS * nominalWeight;
      conversionBaseUnit = "KG";
    } else {
      const convKey = `${canonicalSku.materialCategoryId}:${unitLabel}`;
      let conversion = batchContext?.unitConversionMap.get(convKey);

      if (!conversion && unitLabel) {
        conversion = await this.prisma.pricingUnitConversion.findUnique({
          where: {
            materialCategoryId_fromLabel: {
              materialCategoryId: canonicalSku.materialCategoryId,
              fromLabel: unitLabel,
            },
          },
        });
      }

      if (!conversion || conversion.isAmbiguous) {
        await this.markStatus(
          raw.id,
          "QUARANTINED",
          !conversion
            ? `No PricingUnitConversion found for materialCategoryId=${canonicalSku.materialCategoryId} fromLabel="${unitLabel}"`
            : `Conversion for "${unitLabel}" is flagged isAmbiguous — requires explicit override, not a guess`
        );
        return "QUARANTINED";
      }

      conversionFactor = Number(conversion.factor);
      conversionBaseUnit = conversion.toBaseUnit;
    }

    const pricePerBaseUnit = price / conversionFactor;

    const taxTreatment =
      source?.defaultTaxTreatment && source.defaultTaxTreatment !== "UNKNOWN"
        ? source.defaultTaxTreatment
        : "UNKNOWN";

    const asOfDate = this.parseAsOfDate(raw.rawAsOfText);

    const geographyFields = batchContext ? batchContext.geographyFields : await this.resolveGeographyFields(geography);
    if (!geographyFields) {
      // DISTRICT geography whose districtId no longer resolves to a
      // PricingDistrict row — never fabricate a stateId, quarantine instead.
      await this.markStatus(raw.id, "QUARANTINED", `geography.districtId="${(geography as any).districtId}" does not resolve to a known PricingDistrict`);
      return "QUARANTINED";
    }

    await this.prisma.$transaction([
      this.prisma.pricingObservation.create({
        data: {
          rawId: raw.id,
          sourceId: raw.sourceId,
          canonicalSkuId: canonicalSku.id,
          geographyLevel: geographyFields.geographyLevel,
          stateId: geographyFields.stateId,
          districtId: geographyFields.districtId,
          quotedPrice: price,
          quotedUnitLabel: unitLabel || "unknown",
          pricePerBaseUnit,
          baseUnit: conversionBaseUnit,
          taxTreatment,
          priceType: "LIST_PRICE",
          asOfDate,
          fetchedAt: new Date(),
          confidence: "MEDIUM",
        },
      }),
      this.prisma.pricingRawObservation.update({
        where: { id: raw.id },
        data: { parseStatus: "PARSED", parseError: null },
      }),
    ]);

    return "PARSED";
  }

  /**
   * Resolves the caller-supplied NormalizationGeographyContext into the
   * concrete (geographyLevel, stateId, districtId) triple that satisfies the
   * PricingObservation CHECK constraint. For DISTRICT, looks up the
   * district's stateId (a district's state is a structural fact of the
   * dimension table, not a guess). Returns null only when a DISTRICT
   * context's districtId does not resolve to a real PricingDistrict row —
   * callers must quarantine that raw row rather than ever fabricate a
   * stateId.
   */
  private async resolveGeographyFields(
    geography: NormalizationGeographyContext
  ): Promise<{ geographyLevel: "DISTRICT" | "STATE" | "NATIONAL"; stateId: string | null; districtId: string | null } | null> {
    if (geography.geographyLevel === "NATIONAL") {
      return { geographyLevel: "NATIONAL", stateId: null, districtId: null };
    }
    if (geography.geographyLevel === "STATE") {
      return { geographyLevel: "STATE", stateId: geography.stateId, districtId: null };
    }
    const district = await this.prisma.pricingDistrict.findUnique({
      where: { id: geography.districtId },
      select: { stateId: true },
    });
    if (!district) return null;
    return { geographyLevel: "DISTRICT", stateId: district.stateId, districtId: geography.districtId };
  }

  private async markStatus(rawId: string, status: "UNMAPPED" | "QUARANTINED" | "REJECTED", note: string) {
    await this.prisma.pricingRawObservation.update({
      where: { id: rawId },
      data: { parseStatus: status, parseError: note },
    });
  }

  private normalizeLabel(label: string): string {
    return label.trim().toLowerCase().replace(/\s+/g, " ");
  }

  /** Extracts a plain numeric value from free text like "₹58,500/MT" or "58500". Never guesses a unit here. */
  private parsePriceText(text: string): number | null {
    const cleaned = text.replace(/[₹,\s]/g, "");
    const match = cleaned.match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
  }

  private parseAsOfDate(text: string | null): Date | null {
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
