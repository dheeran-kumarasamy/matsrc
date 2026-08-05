import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PricingConfigService } from "./pricing-config.service";
import { PricingAnomalyDetectionService } from "./pricing-anomaly-detection.service";
import { PricingDailyRollupService } from "./pricing-daily-rollup.service";
import { PricingMonthlyRollupService } from "./pricing-monthly-rollup.service";

/**
 * Phase 4: automatic scheduling for the serving-layer jobs built in Phase 3.
 * Both jobs are idempotent (upsert-on-unique-key), so re-running them for
 * the same date/month is always safe — the crons below are deliberately
 * simple re-runs rather than "only run once" jobs.
 *
 * Gated by PricingConfigService.isFeatureEnabled() so the scheduler is a
 * no-op until the pricing feature flag (PRICING_FEATURE_ENABLED) is turned
 * on, consistent with how the rest of the pricing module respects that flag.
 *
 * Daily cron (02:00 UTC): anomaly detection for "today" immediately
 * followed by the daily rollup for "today" — detection must run first so
 * newly-flagged observations are excluded before the rollup aggregates.
 *
 * Monthly-trend cron (03:00 UTC, every day): re-rolls up PricingTrendMonthly
 * for the current month. Running this daily (not just on the 1st) keeps
 * mom/yoy figures fresh as the month's daily rows accumulate; it is cheap
 * because it only re-aggregates PricingDistrictPriceDaily, not raw
 * observations.
 */
@Injectable()
export class PricingSchedulerService {
  private readonly logger = new Logger(PricingSchedulerService.name);

  constructor(
    private readonly config: PricingConfigService,
    private readonly anomalyDetection: PricingAnomalyDetectionService,
    private readonly dailyRollup: PricingDailyRollupService,
    private readonly monthlyRollup: PricingMonthlyRollupService
  ) {}

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
