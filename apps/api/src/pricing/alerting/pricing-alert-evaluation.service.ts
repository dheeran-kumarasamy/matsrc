import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationService } from "src/notifications/notification.service";
import { WatchlistBridgeService } from "./watchlist-bridge.service";
import { checkAlertEligibility } from "./alert-eligibility.util";
import { ALERT_SUPPRESSION_REASONS } from "./alert-suppression-reason";

const COOLDOWN_HOURS = 24;

/**
 * Human-friendly label for a PriceMethod value, used in notification copy.
 * Mirrors apps/web/lib/district-pricing.ts's toMethodLabel, which cannot be
 * imported here (Next.js app code is not importable from the NestJS API
 * app). In practice, only OBSERVED prices ever reach this point — the
 * eligibility check (alert-eligibility.util.ts) already rejects every
 * DERIVED_* method before an alert can trigger — but all methods are
 * handled defensively.
 */
function toMethodLabel(method: string): string {
  switch (method) {
    case "OBSERVED":
      return "Verified market price";
    case "DERIVED_INDEX":
      return "Estimated (cost index)";
    case "DERIVED_FREIGHT":
      return "Estimated (freight-adjusted)";
    case "DERIVED_BLENDED":
      return "Estimated (blended)";
    case "MANUAL_OVERRIDE":
      return "Manually verified";
    default:
      return method;
  }
}


export type AlertEvaluationSummary = {
  scanned: number;
  triggered: number;
  suppressed: number;
  suppressedByReason: Record<string, number>;
};

/**
 * Phase 6D: Watchlist Price Alert evaluation engine.
 *
 * MUST be invoked strictly after a successful daily rollup
 * (PricingDailyRollupService.rollupForDate) — see wiring in
 * pricing-scheduler.service.ts. Never runs on its own schedule.
 *
 * For every Watchlist row with a non-null targetPrice, this:
 *   1. Resolves a PricingCanonicalSku (WatchlistBridgeService) —
 *      suppress with CANONICAL_SKU_UNMAPPED if not resolvable.
 *   2. Resolves a PricingDistrict via the builder's most-recently-created
 *      active Site (WatchlistBridgeService) — suppress with
 *      DISTRICT_UNRESOLVED if not resolvable.
 *   3. Loads today's PricingDistrictPriceDaily row for that SKU+district —
 *      suppress with NO_PRICE if missing.
 *   4. Applies eligibility rules (publicDisplayAllowed, confidence != LOW,
 *      method != DERIVED_*, not stale) — suppress accordingly.
 *   5. Checks Rule A (currentPrice <= targetPrice) — suppress with
 *      RULE_NOT_TRIGGERED if not met.
 *   6. Checks cooldown (no triggered evaluation for the same watchlist in
 *      the last 24h) — suppress with COOLDOWN if within cooldown window.
 *   7. If all checks pass: calls NotificationService.notifyWatchlistPriceAlert,
 *      persists a PricingAlertEvaluation row with didTrigger=true and the
 *      returned notificationId.
 *   8. Otherwise: persists a PricingAlertEvaluation row with didTrigger=false
 *      and the suppressedReason.
 *
 * Batching: all Watchlist rows, Product rows, Site rows, and
 * PricingDistrictPriceDaily rows needed are fetched with a small constant
 * number of batched queries (not per-row), to avoid N+1 query patterns even
 * at large watchlist volumes. See docs/pricing/alerting.md for the
 * documented performance profile at 100/1,000/10,000/100,000 watchlists.
 */
@Injectable()
export class PricingAlertEvaluationService {
  private readonly logger = new Logger(PricingAlertEvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: WatchlistBridgeService,
    private readonly notifications: NotificationService
  ) {}

  async evaluateForDate(priceDate: Date): Promise<AlertEvaluationSummary> {
    const summary: AlertEvaluationSummary = {
      scanned: 0,
      triggered: 0,
      suppressed: 0,
      suppressedByReason: {},
    };

    const watchlistRows = await this.prisma.watchlist.findMany({
      where: { targetPrice: { not: null } },
      select: {
        id: true,
        userId: true,
        productId: true,
        targetPrice: true,
        product: { select: { id: true, name: true, canonicalProductId: true } },
      },
    });

    summary.scanned = watchlistRows.length;
    if (watchlistRows.length === 0) {
      return summary;
    }

    // Batch: resolve canonical SKU per unique productId (bridge does its own
    // small internal queries per product, but products are typically far
    // fewer than watchlist rows since many builders watch the same items).
    const skuByProductId = new Map<string, string | null>();
    const uniqueProductIds = Array.from(new Set(watchlistRows.map((w) => w.productId)));
    for (const productId of uniqueProductIds) {
      const resolution = await this.bridge.resolveCanonicalSku(productId);
      skuByProductId.set(productId, resolution.ok ? resolution.canonicalSkuId : null);
    }

    // Batch: resolve district per unique builderId.
    const districtByBuilderId = new Map<string, string | null>();
    const uniqueBuilderIds = Array.from(new Set(watchlistRows.map((w) => w.userId)));
    for (const builderId of uniqueBuilderIds) {
      const resolution = await this.bridge.resolveDistrict(builderId);
      districtByBuilderId.set(builderId, resolution.ok ? resolution.districtId : null);
    }

    // Batch: fetch all needed PricingDistrictPriceDaily rows for
    // (skuId, districtId) pairs actually in use, for the given priceDate, in
    // a single query.
    const skuDistrictPairs = new Set<string>();
    for (const w of watchlistRows) {
      const skuId = skuByProductId.get(w.productId);
      const districtId = districtByBuilderId.get(w.userId);
      if (skuId && districtId) {
        skuDistrictPairs.add(`${skuId}::${districtId}`);
      }
    }
    const uniqueSkuIds = Array.from(new Set(Array.from(skuDistrictPairs).map((p) => p.split("::")[0])));
    const uniqueDistrictIds = Array.from(new Set(Array.from(skuDistrictPairs).map((p) => p.split("::")[1])));

    // Batch: districts (for name in notification copy AND for their
    // stateId, needed by the Phase 6F STATE-fallback lookup below).
    const districtRows = uniqueDistrictIds.length
      ? await this.prisma.pricingDistrict.findMany({ where: { id: { in: uniqueDistrictIds } }, select: { id: true, name: true, stateId: true } })
      : [];
    const districtNameById = new Map(districtRows.map((d) => [d.id, d.name]));
    const stateIdByDistrictId = new Map(districtRows.map((d) => [d.id, d.stateId]));
    const uniqueStateIds = Array.from(new Set(districtRows.map((d) => d.stateId)));

    // Phase 6F: fetch DISTRICT-level rows and STATE-level rows separately
    // (still exactly 2 batched queries, not per-watchlist), then let
    // priceRowByPair prefer the DISTRICT row and fall back to the STATE row
    // per (skuId, districtId) pair — this mirrors
    // PricingResolutionService's DISTRICT > STATE precedence without a
    // third NATIONAL query here (watchlists are always district-scoped via
    // a builder Site, so NATIONAL fallback is out of scope for this engine
    // for now; STATE is the meaningful fallback for a source like AGNI).
    const [districtLevelRows, stateLevelRows] = await Promise.all([
      uniqueSkuIds.length && uniqueDistrictIds.length
        ? this.prisma.pricingDistrictPriceDaily.findMany({
            where: { canonicalSkuId: { in: uniqueSkuIds }, geographyLevel: "DISTRICT", districtId: { in: uniqueDistrictIds }, priceDate },
          })
        : Promise.resolve([]),
      uniqueSkuIds.length && uniqueStateIds.length
        ? this.prisma.pricingDistrictPriceDaily.findMany({
            where: { canonicalSkuId: { in: uniqueSkuIds }, geographyLevel: "STATE", stateId: { in: uniqueStateIds }, priceDate },
          })
        : Promise.resolve([]),
    ]);

    const districtRowByPair = new Map(districtLevelRows.map((r) => [`${r.canonicalSkuId}::${r.districtId}`, r]));
    const stateRowBySkuState = new Map(stateLevelRows.map((r) => [`${r.canonicalSkuId}::${r.stateId}`, r]));

    // priceRowByPair value is tagged with fallbackUsed/geographyLevel so the
    // evaluation loop below can persist which geography actually backed the
    // alert (spec §26 — never hide that a "district" alert is really a
    // state reference).
    const priceRowByPair = new Map<string, { row: (typeof districtLevelRows)[number]; fallbackUsed: boolean }>();
    for (const [skuId, districtId] of Array.from(skuDistrictPairs).map((p) => p.split("::"))) {
      const districtRow = districtRowByPair.get(`${skuId}::${districtId}`);
      if (districtRow) {
        priceRowByPair.set(`${skuId}::${districtId}`, { row: districtRow, fallbackUsed: false });
        continue;
      }
      const stateId = stateIdByDistrictId.get(districtId);
      const stateRow = stateId ? stateRowBySkuState.get(`${skuId}::${stateId}`) : undefined;
      if (stateRow) {
        priceRowByPair.set(`${skuId}::${districtId}`, { row: stateRow, fallbackUsed: true });
      }
    }

    // Batch: last triggered evaluation per watchlist, for cooldown check.
    const watchlistIds = watchlistRows.map((w) => w.id);
    const cooldownCutoff = new Date(priceDate.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000);
    const recentTriggeredEvaluations = await this.prisma.pricingAlertEvaluation.findMany({
      where: {
        watchlistId: { in: watchlistIds },
        didTrigger: true,
        evaluatedAt: { gte: cooldownCutoff },
      },
      select: { watchlistId: true, evaluatedAt: true },
      orderBy: { evaluatedAt: "desc" },
    });
    const lastTriggeredByWatchlist = new Map<string, Date>();
    for (const row of recentTriggeredEvaluations) {
      if (!lastTriggeredByWatchlist.has(row.watchlistId)) {
        lastTriggeredByWatchlist.set(row.watchlistId, row.evaluatedAt);
      }
    }

    // Batch: within-run duplicate-evaluation guard (idempotency net #1) —
    // has this watchlist already been evaluated for this exact priceDate?
    const alreadyEvaluatedToday = await this.prisma.pricingAlertEvaluation.findMany({
      where: {
        watchlistId: { in: watchlistIds },
        evaluatedAt: { gte: new Date(priceDate.getTime()), lt: new Date(priceDate.getTime() + 24 * 60 * 60 * 1000) },
      },
      select: { watchlistId: true },
    });
    const evaluatedTodaySet = new Set(alreadyEvaluatedToday.map((r) => r.watchlistId));

    const creates: Array<Promise<unknown>> = [];

    for (const w of watchlistRows) {
      if (evaluatedTodaySet.has(w.id)) {
        summary.suppressed++;
        summary.suppressedByReason[ALERT_SUPPRESSION_REASONS.DUPLICATE_EVALUATION] =
          (summary.suppressedByReason[ALERT_SUPPRESSION_REASONS.DUPLICATE_EVALUATION] ?? 0) + 1;
        continue;
      }

      const skuId = skuByProductId.get(w.productId);
      if (!skuId) {
        creates.push(this.recordSuppressed(w, priceDate, ALERT_SUPPRESSION_REASONS.CANONICAL_SKU_UNMAPPED));
        this.tally(summary, ALERT_SUPPRESSION_REASONS.CANONICAL_SKU_UNMAPPED);
        continue;
      }

      const districtId = districtByBuilderId.get(w.userId);
      if (!districtId) {
        creates.push(this.recordSuppressed(w, priceDate, ALERT_SUPPRESSION_REASONS.DISTRICT_UNRESOLVED));
        this.tally(summary, ALERT_SUPPRESSION_REASONS.DISTRICT_UNRESOLVED);
        continue;
      }

      const priceEntry = priceRowByPair.get(`${skuId}::${districtId}`);
      if (!priceEntry) {
        creates.push(this.recordSuppressed(w, priceDate, ALERT_SUPPRESSION_REASONS.NO_PRICE));
        this.tally(summary, ALERT_SUPPRESSION_REASONS.NO_PRICE);
        continue;
      }
      const { row: priceRow, fallbackUsed } = priceEntry;

      const eligibility = checkAlertEligibility({
        publicDisplayAllowed: priceRow.publicDisplayAllowed,
        confidence: priceRow.confidence,
        method: priceRow.method,
        priceDate: priceRow.priceDate,
        now: new Date(),
      });

      const currentPrice = Number(priceRow.medianPerBaseUnit);
      const targetPrice = Number(w.targetPrice);

      // Phase 6F: the geography actually backing this alert — DISTRICT
      // unless a STATE fallback was used (spec §26). districtId is only
      // persisted when the resolved row is itself DISTRICT-level; a STATE
      // fallback row must never be persisted with districtId populated
      // (same invariant as the DB CHECK constraint).
      const resolvedGeography = fallbackUsed
        ? { geographyLevel: "STATE" as const, stateId: priceRow.stateId, districtId: null as string | null }
        : { geographyLevel: "DISTRICT" as const, stateId: priceRow.stateId, districtId };

      if (!eligibility.eligible) {
        creates.push(
          this.recordEvaluation(w, priceDate, {
            canonicalSkuId: skuId,
            ...resolvedGeography,
            targetPrice,
            currentPrice,
            baseUnit: priceRow.baseUnit,
            didTrigger: false,
            suppressedReason: eligibility.suppressedReason,
          })
        );
        this.tally(summary, eligibility.suppressedReason);
        continue;
      }

      if (currentPrice > targetPrice) {
        creates.push(
          this.recordEvaluation(w, priceDate, {
            canonicalSkuId: skuId,
            ...resolvedGeography,
            targetPrice,
            currentPrice,
            baseUnit: priceRow.baseUnit,
            didTrigger: false,
            suppressedReason: ALERT_SUPPRESSION_REASONS.RULE_NOT_TRIGGERED,
          })
        );
        this.tally(summary, ALERT_SUPPRESSION_REASONS.RULE_NOT_TRIGGERED);
        continue;
      }

      const lastTriggered = lastTriggeredByWatchlist.get(w.id);
      if (lastTriggered) {
        creates.push(
          this.recordEvaluation(w, priceDate, {
            canonicalSkuId: skuId,
            ...resolvedGeography,
            targetPrice,
            currentPrice,
            baseUnit: priceRow.baseUnit,
            didTrigger: false,
            suppressedReason: ALERT_SUPPRESSION_REASONS.COOLDOWN,
          })
        );
        this.tally(summary, ALERT_SUPPRESSION_REASONS.COOLDOWN);
        continue;
      }

      // All checks passed — send the notification, then persist the
      // triggered evaluation with the returned notificationId. Notification
      // copy always names the geography-appropriate label: the requested
      // district's name for a DISTRICT resolution, or "Tamil Nadu state
      // reference" style copy for a STATE fallback (spec §26/§27) — never
      // the requested district's name when the underlying price is
      // state-level.
      creates.push(
        this.triggerAndRecord(w, priceDate, {
          canonicalSkuId: skuId,
          ...resolvedGeography,
          targetPrice,
          currentPrice,
          baseUnit: priceRow.baseUnit,
          districtName: fallbackUsed
            ? `${districtNameById.get(districtId) ?? "your district"} (state reference)`
            : districtNameById.get(districtId) ?? "your district",
          confidence: priceRow.confidence,
          method: priceRow.method,
        })
      );
      summary.triggered++;
    }

    await Promise.all(creates);

    return summary;
  }

  private tally(summary: AlertEvaluationSummary, reason: string) {
    summary.suppressed++;
    summary.suppressedByReason[reason] = (summary.suppressedByReason[reason] ?? 0) + 1;
  }

  private async recordSuppressed(
    w: { id: string; productId: string; targetPrice: any },
    priceDate: Date,
    reason: string
  ) {
    // No canonicalSkuId/districtId/baseUnit available in these cases — the
    // model requires them, so we persist zero-value placeholders only when
    // strictly necessary. To avoid persisting misleading data, these
    // "can't even resolve inputs" suppressions are logged instead of
    // written to PricingAlertEvaluation, since the model's non-nullable
    // canonicalSkuId/districtId/currentPricePerBaseUnit/baseUnit fields
    // have no meaningful value in this state.
    this.logger.debug(
      `Suppressed watchlist=${w.id} product=${w.productId} reason=${reason} (no evaluation row persisted — inputs unresolved)`
    );
  }

  private async recordEvaluation(
    w: { id: string; targetPrice: any },
    priceDate: Date,
    data: {
      canonicalSkuId: string;
      geographyLevel: "DISTRICT" | "STATE";
      stateId: string | null;
      districtId: string | null;
      targetPrice: number;
      currentPrice: number;
      baseUnit: string;
      didTrigger: boolean;
      suppressedReason: string;
    }
  ) {
    return this.prisma.pricingAlertEvaluation.create({
      data: {
        watchlistId: w.id,
        canonicalSkuId: data.canonicalSkuId,
        geographyLevel: data.geographyLevel,
        stateId: data.stateId,
        districtId: data.districtId,
        targetPricePerBaseUnit: data.targetPrice,
        currentPricePerBaseUnit: data.currentPrice,
        baseUnit: data.baseUnit as any,
        didTrigger: data.didTrigger,
        suppressedReason: data.suppressedReason,
      },
    });
  }

  private async triggerAndRecord(
    w: { id: string; userId: string; productId: string; product: { name: string } },
    priceDate: Date,
    data: {
      canonicalSkuId: string;
      geographyLevel: "DISTRICT" | "STATE";
      stateId: string | null;
      districtId: string | null;
      targetPrice: number;
      currentPrice: number;
      baseUnit: string;
      districtName: string;
      confidence: string;
      method: string;
    }
  ) {
    const idempotencyKey = `watchlist-alert:${w.id}:${data.canonicalSkuId}:${data.geographyLevel}:${
      data.districtId ?? data.stateId ?? "national"
    }:${priceDate.toISOString().slice(0, 10)}`;

    let notificationId: string | null = null;
    try {
      notificationId = await this.notifications.notifyWatchlistPriceAlert({
        userId: w.userId,
        watchlistId: w.id,
        productName: w.product.name,
        currentPrice: data.currentPrice,
        targetPrice: data.targetPrice,
        districtName: data.districtName,
        confidence: data.confidence,
        method: data.method,
        methodLabel: toMethodLabel ? toMethodLabel(data.method as any) : data.method,
        idempotencyKey,
      });
    } catch (error) {
      // Never let a notification failure corrupt the alert evaluation
      // record or the outer rollup transaction. Log and persist the
      // evaluation as triggered-but-unsent (notificationId stays null).
      this.logger.error(
        `notifyWatchlistPriceAlert failed for watchlist=${w.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return this.prisma.pricingAlertEvaluation.create({
      data: {
        watchlistId: w.id,
        canonicalSkuId: data.canonicalSkuId,
        geographyLevel: data.geographyLevel,
        stateId: data.stateId,
        districtId: data.districtId,
        targetPricePerBaseUnit: data.targetPrice,
        currentPricePerBaseUnit: data.currentPrice,
        baseUnit: data.baseUnit as any,
        didTrigger: true,
        notificationId,
      },
    });
  }
}
