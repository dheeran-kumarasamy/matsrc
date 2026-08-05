import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { scaledMedianAbsoluteDeviation } from "./pricing-stats.util";

/**
 * Flags statistically or policy-suspect PricingObservation rows (spec §6 /
 * AnomalyReason enum). Never deletes an observation — anomalies are
 * soft-exclusions (isExcluded=true + exclusionReason) with a paired
 * PricingAnomaly audit row, so a disputed exclusion can always be reviewed
 * and reversed by an admin.
 *
 * Three checks, run per (canonicalSkuId, districtId) group over
 * non-excluded, PARSED-origin observations:
 *   1. OUTLIER_MAD  — pricePerBaseUnit further than 3x the scaled MAD from
 *      the group median (skipped for groups with < 4 observations — MAD is
 *      meaningless on tiny samples).
 *   2. IMPLAUSIBLE_RANGE — outside the material category's hard
 *      floor/ceiling (when configured).
 *   3. STALE_AS_OF — asOfDate older than the source's freshnessSlaHours
 *      (when both are set).
 */
@Injectable()
export class PricingAnomalyDetectionService {
  private readonly logger = new Logger(PricingAnomalyDetectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Runs all three checks over the given day's not-yet-excluded observations. */
  async detectForDate(priceDate: Date): Promise<{ scanned: number; flagged: number }> {
    const startOfDay = new Date(priceDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    const observations = await this.prisma.pricingObservation.findMany({
      where: { isExcluded: false, fetchedAt: { gte: startOfDay, lt: endOfDay } },
      include: {
        canonicalSku: { include: { materialCategory: true } },
        source: true,
      },
    });

    let flagged = 0;

    // Group by (canonicalSkuId, districtId) for the MAD check.
    type Observation = (typeof observations)[number];
    const groups = new Map<string, Observation[]>();
    for (const obs of observations) {
      const key = `${obs.canonicalSkuId}::${obs.districtId}`;
      const bucket = groups.get(key) ?? [];
      bucket.push(obs);
      groups.set(key, bucket);
    }

    for (const bucket of groups.values()) {
      if (bucket.length < 4) continue; // MAD is not meaningful on tiny samples
      const values = bucket.map((o: Observation) => Number(o.pricePerBaseUnit));

      const { median: med, scaledMad } = scaledMedianAbsoluteDeviation(values);
      if (scaledMad === 0) continue; // every value identical — nothing to flag

      for (const obs of bucket) {
        const value = Number(obs.pricePerBaseUnit);
        if (Math.abs(value - med) > 3 * scaledMad) {
          await this.flag(obs.id, "OUTLIER_MAD", `value=${value} groupMedian=${med} scaledMad=${scaledMad}`);
          flagged++;
        }
      }
    }

    // Implausible-range + stale-as-of checks run per observation independently.
    for (const obs of observations) {
      if (obs.isExcluded) continue; // may have just been excluded by the MAD check above

      const category = obs.canonicalSku.materialCategory;
      const value = Number(obs.pricePerBaseUnit);
      if (category.floorPerBaseUnit !== null && value < Number(category.floorPerBaseUnit)) {
        await this.flag(obs.id, "IMPLAUSIBLE_RANGE", `value=${value} below floor=${category.floorPerBaseUnit}`);
        flagged++;
        continue;
      }
      if (category.ceilingPerBaseUnit !== null && value > Number(category.ceilingPerBaseUnit)) {
        await this.flag(obs.id, "IMPLAUSIBLE_RANGE", `value=${value} above ceiling=${category.ceilingPerBaseUnit}`);
        flagged++;
        continue;
      }

      const slaHours = obs.source.freshnessSlaHours;
      if (slaHours !== null && obs.asOfDate) {
        const ageHours = (obs.fetchedAt.getTime() - obs.asOfDate.getTime()) / (1000 * 60 * 60);
        if (ageHours > slaHours) {
          await this.flag(obs.id, "STALE_AS_OF", `asOfDate age=${ageHours.toFixed(1)}h exceeds SLA=${slaHours}h`);
          flagged++;
        }
      }
    }

    this.logger.log(`detectForDate(${startOfDay.toISOString().slice(0, 10)}): scanned=${observations.length} flagged=${flagged}`);
    return { scanned: observations.length, flagged };
  }

  private async flag(
    observationId: string,
    reason: "OUTLIER_MAD" | "IMPLAUSIBLE_RANGE" | "STALE_AS_OF",
    detail: string
  ) {
    await this.prisma.$transaction([
      this.prisma.pricingObservation.update({
        where: { id: observationId },
        data: { isExcluded: true, exclusionReason: `${reason}: ${detail}` },
      }),
      this.prisma.pricingAnomaly.create({
        data: { observationId, reason, detail },
      }),
    ]);
  }
}
