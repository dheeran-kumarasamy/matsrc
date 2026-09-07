import { Controller, Get, Logger, Query, UseGuards } from "@nestjs/common";
import { CronSecretGuard } from "./cron-secret.guard";
import { PricingSchedulerService } from "./pricing-scheduler.service";

/**
 * HTTP-triggerable equivalents of PricingSchedulerService's cron methods,
 * invoked by Vercel Cron Jobs (see apps/api/vercel.json's `crons` array).
 */
@Controller("pricing/cron")
@UseGuards(CronSecretGuard)
export class PricingCronController {
  private readonly logger = new Logger(PricingCronController.name);

  constructor(private readonly scheduler: PricingSchedulerService) {}

  /** Phase 3: Scheduled ingestion for due & eligible endpoints. */
  @Get("ingest")
  async runIngest(@Query("dryRun") dryRunParam?: string) {
    this.logger.log("runIngest: triggered via Vercel Cron Job");
    const isDry = dryRunParam !== undefined ? dryRunParam.toLowerCase() === "true" || dryRunParam === "1" : undefined;
    return this.scheduler.runIngestionJob({ dryRun: isDry });
  }

  /** Phase 3: Scheduled normalization for PENDING raw observations. */
  @Get("normalize")
  async runNormalize(@Query("dryRun") dryRunParam?: string) {
    this.logger.log("runNormalize: triggered via Vercel Cron Job");
    const isDry = dryRunParam !== undefined ? dryRunParam.toLowerCase() === "true" || dryRunParam === "1" : undefined;
    return this.scheduler.runNormalizationJob({ dryRun: isDry });
  }

  /** Mirrors PricingSchedulerService's daily cron (anomaly detection -> daily rollup -> alert evaluation). */
  @Get("daily")
  async runDaily() {
    this.logger.log("runDaily: triggered via Vercel Cron Job");
    await this.scheduler.runDailyJobs();
    return { ok: true, job: "pricing-daily-rollup" };
  }

  /** Mirrors PricingSchedulerService's monthly-trend cron. */
  @Get("monthly")
  async runMonthly() {
    this.logger.log("runMonthly: triggered via Vercel Cron Job");
    await this.scheduler.runMonthlyJob();
    return { ok: true, job: "pricing-monthly-rollup" };
  }
}

