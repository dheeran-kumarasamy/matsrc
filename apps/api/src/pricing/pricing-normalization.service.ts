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
   * Processes up to `limit` PENDING raw observations, stamping every
   * resulting PricingObservation with the explicit `geography` the caller
   * provides (Phase 6F — see NormalizationGeographyContext). Kept
   * backward-compatible with the pre-Phase-6F call shape: passing a bare
   * districtId string is equivalent to `{ geographyLevel: "DISTRICT",
   * districtId }`.
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

    let parsed = 0;
    let unmapped = 0;
    let quarantined = 0;
    let rejected = 0;

    for (const raw of pending) {
      const outcome = await this.normalizeOne(raw, context);
      if (outcome === "PARSED") parsed++;
      else if (outcome === "UNMAPPED") unmapped++;
      else if (outcome === "QUARANTINED") quarantined++;
      else rejected++;
    }

    this.logger.log(
      `normalizeBatch: geographyLevel=${context.geographyLevel} processed=${pending.length} parsed=${parsed} unmapped=${unmapped} quarantined=${quarantined} rejected=${rejected}`
    );

    return { processed: pending.length, parsed, unmapped, quarantined, rejected };
  }

  private async normalizeOne(
    raw: { id: string; sourceId: string; rawSkuLabel: string | null; rawPriceText: string | null; rawUnitText: string | null; rawAsOfText: string | null },
    geography: NormalizationGeographyContext
  ): Promise<"PARSED" | "UNMAPPED" | "QUARANTINED" | "REJECTED"> {
    if (!raw.rawSkuLabel || !raw.rawPriceText) {
      await this.markStatus(raw.id, "REJECTED", "Missing rawSkuLabel or rawPriceText");
      return "REJECTED";
    }

    const normalizedLabel = this.normalizeLabel(raw.rawSkuLabel);

    let alias = await this.prisma.pricingSkuAlias.findUnique({
      where: { sourceId_rawLabel: { sourceId: raw.sourceId, rawLabel: raw.rawSkuLabel } },
    });

    if (!alias) {
      // First time we've seen this exact raw label from this source.
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

    if (!alias.canonicalSkuId) {
      await this.markStatus(raw.id, "UNMAPPED", "No canonicalSkuId on alias — queued for admin triage");
      return "UNMAPPED";
    }

    const canonicalSku = await this.prisma.pricingCanonicalSku.findUnique({
      where: { id: alias.canonicalSkuId },
    });
    if (!canonicalSku) {
      await this.markStatus(raw.id, "UNMAPPED", "Alias points at a canonicalSkuId that no longer exists");
      return "UNMAPPED";
    }

    const price = this.parsePriceText(raw.rawPriceText);
    if (price === null) {
      await this.markStatus(raw.id, "REJECTED", `Unparseable rawPriceText: "${raw.rawPriceText}"`);
      return "REJECTED";
    }

    const unitLabel = (raw.rawUnitText ?? "").trim().toLowerCase();
    const conversion = unitLabel
      ? await this.prisma.pricingUnitConversion.findUnique({
          where: {
            materialCategoryId_fromLabel: {
              materialCategoryId: canonicalSku.materialCategoryId,
              fromLabel: unitLabel,
            },
          },
        })
      : null;

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

    const pricePerBaseUnit = price / Number(conversion.factor);

    const asOfDate = this.parseAsOfDate(raw.rawAsOfText);

    const geographyFields = await this.resolveGeographyFields(geography);
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
          baseUnit: conversion.toBaseUnit,
          taxTreatment: "UNKNOWN",
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
