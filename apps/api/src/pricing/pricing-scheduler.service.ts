import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "src/prisma/prisma.service";
import { PricingConfigService } from "./pricing-config.service";
import { PricingAnomalyDetectionService } from "./pricing-anomaly-detection.service";
import { PricingDailyRollupService } from "./pricing-daily-rollup.service";
import { PricingMonthlyRollupService } from "./pricing-monthly-rollup.service";
import { PricingAlertEvaluationService } from "./alerting/pricing-alert-evaluation.service";
import { PricingIngestionService } from "./pricing-ingestion.service";
import { PricingNormalizationService } from "./pricing-normalization.service";
import { hasNativeParserForUrl } from "./native-http-extractor-client";

export interface EndpointEligibilityResult {
  endpointId: string;
  sourceCode: string;
  sourceId: string;
  url: string;
  eligible: boolean;
  due: boolean;
  skipReason: string | null;
  lastFetchedAt: Date | null;
}

export interface IngestionJobSummary {
  ok: boolean;
  job: string;
  dryRun: boolean;
  discovered: number;
  eligible: number;
  due: number;
  started: number;
  succeeded: number;
  failed: number;
  skipped: number;
  endpoints?: Array<{
    endpointId: string;
    sourceCode: string;
    status: string;
    itemsFetched?: number;
    itemsLanded?: number;
    itemsDuplicate?: number;
    reason?: string;
  }>;
}

export interface NormalizationJobSummary {
  ok: boolean;
  job: string;
  dryRun: boolean;
  rawCandidates: number;
  processed: number;
  parsed: number;
  unmapped: number;
  quarantined: number;
  rejected: number;
  endpointsProcessed: number;
  endpoints?: Array<{
    endpointId: string;
    sourceCode: string;
    candidatesCount: number;
    parsed: number;
    quarantined: number;
    unmapped: number;
    rejected: number;
  }>;
}

/**
 * Phase 3 & Phase 4: automatic scheduling for ingestion, normalization, and
 * serving-layer jobs.
 *
 * Ingestion and Normalization run on separate stages:
 *   - runIngestionJob: checks eligibility & compliance, enforces concurrency locks, lands raw observations.
 *   - runNormalizationJob: normalizes PENDING raw rows using endpoint-scoped geography.
 *   - runDailyJobs: anomaly detection -> daily rollup -> watchlist alerts.
 *   - runMonthlyJob: monthly trend rollups.
 */
@Injectable()
export class PricingSchedulerService {
  private readonly logger = new Logger(PricingSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PricingConfigService,
    private readonly ingestion: PricingIngestionService,
    private readonly normalization: PricingNormalizationService,
    private readonly anomalyDetection: PricingAnomalyDetectionService,
    private readonly dailyRollup: PricingDailyRollupService,
    private readonly monthlyRollup: PricingMonthlyRollupService,
    private readonly alertEvaluation: PricingAlertEvaluationService
  ) {}

  /**
   * Evaluates all configured endpoints against compliance gates, feature flags,
   * extractor availability, and cadence due status.
   */
  async getEligibleEndpoints(): Promise<EndpointEligibilityResult[]> {
    const endpoints = await this.prisma.pricingSourceEndpoint.findMany({
      include: { source: true },
    });

    const now = new Date();
    const results: EndpointEligibilityResult[] = [];

    for (const ep of endpoints) {
      let eligible = true;
      let skipReason: string | null = null;

      if (!this.config.isEnabled()) {
        eligible = false;
        skipReason = "PRICING_FEATURE_ENABLED is false";
      } else if (!ep.source.isEnabled) {
        eligible = false;
        skipReason = "Source is disabled (PricingSource.isEnabled = false)";
      } else if (!ep.isEnabled) {
        eligible = false;
        skipReason = "Endpoint is disabled (PricingSourceEndpoint.isEnabled = false)";
      } else if (!ep.source.robotsAllowed) {
        eligible = false;
        skipReason = "Source compliance gate failed (robotsAllowed = false)";
      } else if (!ep.source.tosReviewedAt) {
        eligible = false;
        skipReason = "Source compliance gate failed (tosReviewedAt is null)";
      } else {
        const hasNative = hasNativeParserForUrl(ep.url);
        const hasApifyActor = ep.source.apifyActorId !== null;
        const liveApify = this.config.isApifyLiveEnabled();

        if (!hasNative && (!hasApifyActor || !liveApify)) {
          eligible = false;
          skipReason = !hasApifyActor
            ? "No extractor registered for endpoint URL or source actor"
            : "Live Apify execution is disabled (PRICING_APIFY_LIVE_ENABLED = false)";
        }
      }

      const slaHours = ep.source.freshnessSlaHours ?? 24;
      const dueThresholdMs = slaHours * 3600 * 1000;
      const isDue = !ep.lastFetchedAt || now.getTime() - ep.lastFetchedAt.getTime() >= dueThresholdMs;

      results.push({
        endpointId: ep.id,
        sourceCode: ep.source.code,
        sourceId: ep.source.id,
        url: ep.url,
        eligible,
        due: isDue,
        skipReason,
        lastFetchedAt: ep.lastFetchedAt,
      });
    }

    return results;
  }

  /**
   * Executes scheduled ingestion for due & eligible endpoints.
   */
  async runIngestionJob(options?: { dryRun?: boolean; maxEndpoints?: number }): Promise<IngestionJobSummary> {
    const dryRun = options?.dryRun ?? this.config.isCronDryRunEnabled();

    if (!this.config.isEnabled()) {
      return {
        ok: true,
        job: "pricing-ingest",
        dryRun,
        discovered: 0,
        eligible: 0,
        due: 0,
        started: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        endpoints: [],
      };
    }

    const evaluations = await this.getEligibleEndpoints();
    const discovered = evaluations.length;
    const eligibleCount = evaluations.filter((e) => e.eligible).length;
    const dueCount = evaluations.filter((e) => e.eligible && e.due).length;

    const toRun = evaluations.filter((e) => e.eligible && e.due);
    const max = options?.maxEndpoints ?? 5;
    const batch = toRun.slice(0, max);

    if (dryRun) {
      this.logger.log(
        `runIngestionJob [DRY-RUN]: discovered=${discovered} eligible=${eligibleCount} due=${dueCount} wouldRun=${batch.length}`
      );
      return {
        ok: true,
        job: "pricing-ingest",
        dryRun: true,
        discovered,
        eligible: eligibleCount,
        due: dueCount,
        started: 0,
        succeeded: 0,
        failed: 0,
        skipped: discovered - batch.length,
        endpoints: evaluations.map((e) => ({
          endpointId: e.endpointId,
          sourceCode: e.sourceCode,
          status: e.eligible && e.due ? "WOULD_RUN" : "SKIPPED",
          reason: e.skipReason ?? (e.due ? undefined : "Not due yet"),
        })),
      };
    }

    let started = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = discovered - batch.length;
    const endpointSummaries: IngestionJobSummary["endpoints"] = [];

    for (const e of evaluations) {
      if (!batch.some((b) => b.endpointId === e.endpointId)) {
        endpointSummaries.push({
          endpointId: e.endpointId,
          sourceCode: e.sourceCode,
          status: "SKIPPED",
          reason: e.skipReason ?? "Not due yet or exceeds batch limit",
        });
      }
    }

    for (const epEval of batch) {
      const activeRun = await this.prisma.pricingScrapeRun.findFirst({
        where: {
          sourceId: epEval.sourceId,
          status: "RUNNING",
          startedAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
      });

      if (activeRun) {
        skipped++;
        endpointSummaries.push({
          endpointId: epEval.endpointId,
          sourceCode: epEval.sourceCode,
          status: "SKIPPED",
          reason: "Concurrent execution in progress (active RUNNING PricingScrapeRun)",
        });
        continue;
      }

      started++;
      this.logger.log(`pricing.ingest.endpoint_started: endpointId=${epEval.endpointId} source=${epEval.sourceCode}`);

      try {
        const res = await this.ingestion.ingestEndpoint(epEval.endpointId, "cron:ingest");
        succeeded++;
        this.logger.log(
          `pricing.ingest.endpoint_completed: endpointId=${epEval.endpointId} landed=${res.itemsLanded} fetched=${res.itemsFetched}`
        );
        endpointSummaries.push({
          endpointId: epEval.endpointId,
          sourceCode: epEval.sourceCode,
          status: "SUCCEEDED",
          itemsFetched: res.itemsFetched,
          itemsLanded: res.itemsLanded,
          itemsDuplicate: res.itemsDuplicate,
        });
      } catch (err) {
        failed++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `pricing.ingest.endpoint_failed: endpointId=${epEval.endpointId} error=${errorMessage}`
        );
        endpointSummaries.push({
          endpointId: epEval.endpointId,
          sourceCode: epEval.sourceCode,
          status: "FAILED",
          reason: errorMessage,
        });
      }
    }

    return {
      ok: true,
      job: "pricing-ingest",
      dryRun: false,
      discovered,
      eligible: eligibleCount,
      due: dueCount,
      started,
      succeeded,
      failed,
      skipped,
      endpoints: endpointSummaries,
    };
  }

  /**
   * Executes scheduled normalization for PENDING raw observations.
   */
  async runNormalizationJob(options?: { dryRun?: boolean; limitPerEndpoint?: number }): Promise<NormalizationJobSummary> {
    const dryRun = options?.dryRun ?? this.config.isCronDryRunEnabled();

    if (!this.config.isEnabled()) {
      return {
        ok: true,
        job: "pricing-normalize",
        dryRun,
        rawCandidates: 0,
        processed: 0,
        parsed: 0,
        unmapped: 0,
        quarantined: 0,
        rejected: 0,
        endpointsProcessed: 0,
        endpoints: [],
      };
    }

    const pendingRawObs = await this.prisma.pricingRawObservation.findMany({
      where: { parseStatus: "PENDING" },
      select: { sourceId: true, sourceUrl: true },
    });

    const candidateCount = pendingRawObs.length;

    const endpoints = await this.prisma.pricingSourceEndpoint.findMany({
      select: { id: true, sourceId: true, url: true, source: { select: { code: true } } },
    });

    const endpointPendingCounts = new Map<string, { endpointId: string; sourceCode: string; count: number }>();
    for (const ep of endpoints) {
      const matchCount = pendingRawObs.filter((r) => r.sourceId === ep.sourceId && r.sourceUrl === ep.url).length;
      if (matchCount > 0) {
        endpointPendingCounts.set(ep.id, { endpointId: ep.id, sourceCode: ep.source.code, count: matchCount });
      }
    }

    if (dryRun) {
      this.logger.log(`runNormalizationJob [DRY-RUN]: rawCandidates=${candidateCount} endpointsWithPending=${endpointPendingCounts.size}`);
      return {
        ok: true,
        job: "pricing-normalize",
        dryRun: true,
        rawCandidates: candidateCount,
        processed: 0,
        parsed: 0,
        unmapped: 0,
        quarantined: 0,
        rejected: 0,
        endpointsProcessed: 0,
        endpoints: Array.from(endpointPendingCounts.values()).map((e) => ({
          endpointId: e.endpointId,
          sourceCode: e.sourceCode,
          candidatesCount: e.count,
          parsed: 0,
          quarantined: 0,
          unmapped: 0,
          rejected: 0,
        })),
      };
    }

    const tStart = performance.now();
    let totalProcessed = 0;
    let totalParsed = 0;
    let totalUnmapped = 0;
    let totalQuarantined = 0;
    let totalRejected = 0;
    const endpointSummaries: NormalizationJobSummary["endpoints"] = [];
    const limit = options?.limitPerEndpoint ?? 100;

    for (const [epId, info] of endpointPendingCounts.entries()) {
      try {
        const res = await this.normalization.normalizeEndpoint(epId, limit);
        totalProcessed += res.processed;
        totalParsed += res.parsed;
        totalUnmapped += res.unmapped;
        totalQuarantined += res.quarantined;
        totalRejected += res.rejected;

        endpointSummaries.push({
          endpointId: epId,
          sourceCode: info.sourceCode,
          candidatesCount: info.count,
          parsed: res.parsed,
          quarantined: res.quarantined,
          unmapped: res.unmapped,
          rejected: res.rejected,
        });
      } catch (err) {
        this.logger.error(`runNormalizationJob: failed for endpointId=${epId}`, err instanceof Error ? err.stack : String(err));
      }
    }
    const totalMs = (performance.now() - tStart).toFixed(1);

    this.logger.log(
      `pricing.normalize.completed: rawCandidates=${candidateCount} processed=${totalProcessed} parsed=${totalParsed} quarantined=${totalQuarantined} unmapped=${totalUnmapped} timing={totalMs:${totalMs}}`
    );

    return {
      ok: true,
      job: "pricing-normalize",
      dryRun: false,
      rawCandidates: candidateCount,
      processed: totalProcessed,
      parsed: totalParsed,
      unmapped: totalUnmapped,
      quarantined: totalQuarantined,
      rejected: totalRejected,
      endpointsProcessed: endpointSummaries.length,
      endpoints: endpointSummaries,
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: "pricing-daily-rollup" })
  async runDailyJobs(): Promise<void> {
    if (!this.config.isEnabled()) {
      this.logger.debug("runDailyJobs: skipped, PRICING_FEATURE_ENABLED is false");
      return;
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    try {
      const detection = await this.anomalyDetection.detectForDate(today);
      this.logger.log(`runDailyJobs: anomaly detection scanned=${detection.scanned} flagged=${detection.flagged}`);

      const rollup = await this.dailyRollup.rollupForDate(today);
      this.logger.log(`runDailyJobs: daily rollup observedRows=${rollup.observedRows} derivedRows=${rollup.derivedRows}`);

      try {
        const alerts = await this.alertEvaluation.evaluateForDate(today);
        this.logger.log(
          `runDailyJobs: alert evaluation scanned=${alerts.scanned} triggered=${alerts.triggered} suppressed=${alerts.suppressed}`
        );
      } catch (alertError) {
        this.logger.error(
          "runDailyJobs: alert evaluation failed",
          alertError instanceof Error ? alertError.stack : String(alertError)
        );
      }
    } catch (error) {
      this.logger.error("runDailyJobs: failed", error instanceof Error ? error.stack : String(error));
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: "pricing-monthly-rollup" })
  async runMonthlyJob(): Promise<void> {
    if (!this.config.isEnabled()) {
      this.logger.debug("runMonthlyJob: skipped, PRICING_FEATURE_ENABLED is false");
      return;
    }

    const monthStart = new Date();
    monthStart.setUTCHours(0, 0, 0, 0);
    monthStart.setUTCDate(1);

    try {
      const result = await this.monthlyRollup.rollupForMonth(monthStart);
      this.logger.log(`runMonthlyJob: rows=${result.rows}`);
    } catch (error) {
      this.logger.error("runMonthlyJob: failed", error instanceof Error ? error.stack : String(error));
    }
  }
}

