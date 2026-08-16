import { Controller, Get, Logger, UseGuards } from "@nestjs/common";
import { CronSecretGuard } from "./cron-secret.guard";
import { PricingSchedulerService } from "./pricing-scheduler.service";

/**
 * HTTP-triggerable equivalents of PricingSchedulerService's @Cron methods,
 * invoked by Vercel Cron Jobs (see apps/api/vercel.json's `crons` array).
 *
 * WHY THIS EXISTS: apps/api runs as a Vercel serverless function (see
 * apps/api/api/index.ts) — a fresh Nest app is created per invocation, with
 * no long-lived process for @nestjs/schedule's in-memory @Cron timers to
 * fire on. PricingSchedulerService.runDailyJobs()/runMonthlyJob() were
 * therefore never actually executing on a schedule in production, only in
 * local/long-running-server environments. Vercel Cron Jobs make a real,
 * scheduled HTTP request instead, so this controller exposes the exact same
 * methods (no duplicated business logic) behind a secret-guarded route.
 *
 * Deliberately NOT included here: ingestion (PricingIngestionService) and
 * normalization (PricingNormalizationService.normalizeBatch()). Both are
 * intentionally excluded from any automatic/scheduled trigger elsewhere in
 * this codebase too — ingestion is gated by per-source ToS review
 * (isEnabled requires tosReviewedAt) and is only ever invoked manually
 * ("Force Run" in the admin UI), and normalizeBatch() requires an explicit,
 * human-verified NormalizationGeographyContext (there is no safe default —
 * see docs/pricing/batch-d4-production-hardening-validation.md for a
 * documented near-miss where blind normalization would have mislabeled
 * Delhi prices as Tamil Nadu). Automating either here would silently widen
 * scope beyond what has been reviewed elsewhere in this repo.
 */
@Controller("pricing/cron")
@UseGuards(CronSecretGuard)
export class PricingCronController {
  private readonly logger = new Logger(PricingCronController.name);

  constructor(private readonly scheduler: PricingSchedulerService) {}

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
