import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

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
 *   5. Compute pricePerBaseUnit, write the PricingObservation, mark
 *      parseStatus=PARSED.
 *
 * This never mutates PricingRawObservation.payload — only parseStatus (and,
 * once we resolve an observation, the one-to-one `observation` relation).
 */
@Injectable()
export class PricingNormalizationService {
  private readonly logger = new Logger(PricingNormalizationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Processes up to `limit` PENDING raw observations for the given
   * districtId (required — a raw observation's rawLocationText must
   * resolve to a known PricingDistrict for this first cut; unresolvable
   * locations are left PENDING rather than guessed).
   */
  async normalizeBatch(
    districtId: string,
    limit = 100
  ): Promise<{ processed: number; parsed: number; unmapped: number; quarantined: number; rejected: number }> {
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
      const outcome = await this.normalizeOne(raw, districtId);
      if (outcome === "PARSED") parsed++;
      else if (outcome === "UNMAPPED") unmapped++;
      else if (outcome === "QUARANTINED") quarantined++;
      else rejected++;
    }

    this.logger.log(
      `normalizeBatch: processed=${pending.length} parsed=${parsed} unmapped=${unmapped} quarantined=${quarantined} rejected=${rejected}`
    );

    return { processed: pending.length, parsed, unmapped, quarantined, rejected };
  }

  private async normalizeOne(
    raw: { id: string; sourceId: string; rawSkuLabel: string | null; rawPriceText: string | null; rawUnitText: string | null; rawAsOfText: string | null },
    districtId: string
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

    await this.prisma.$transaction([
      this.prisma.pricingObservation.create({
        data: {
          rawId: raw.id,
          sourceId: raw.sourceId,
          canonicalSkuId: canonicalSku.id,
          districtId,
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
