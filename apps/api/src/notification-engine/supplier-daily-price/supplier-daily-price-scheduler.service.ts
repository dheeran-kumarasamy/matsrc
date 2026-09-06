import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { SupplierDailyPriceReminderService } from "./supplier-daily-price-reminder.service";

/**
 * Phase 12 — Daily Price Reminder Scheduler.
 *
 * Reuses the existing `@nestjs/schedule` infrastructure (already used by
 * `PricingSchedulerService`) rather than introducing a second scheduling
 * framework. Runs once daily during business hours (10:00 UTC ≈ late
 * morning IST) — a supplier who has not yet updated today's prices by then
 * gets at most one WhatsApp reminder per business date, enforced by the
 * dedupe key in `SupplierDailyPriceReminderService`.
 *
 * IMPORTANT — Vercel serverless caveat (same as PricingSchedulerService):
 * apps/api is deployed as a Vercel serverless function, so this @Cron
 * handler never actually fires in production without a long-lived process.
 * See `SupplierDailyPriceCronController` for the Vercel Cron Job-triggerable
 * HTTP equivalent (wire into apps/api/vercel.json's `crons` array the same
 * way pricing/cron is wired).
 */
@Injectable()
export class SupplierDailyPriceSchedulerService {
  private readonly logger = new Logger(SupplierDailyPriceSchedulerService.name);

  constructor(private readonly reminder: SupplierDailyPriceReminderService) {}

  @Cron(CronExpression.EVERY_DAY_AT_10AM, { name: "supplier-daily-price-reminder" })
  async run(): Promise<void> {
    try {
      const result = await this.reminder.evaluateAndNotify();
      this.logger.log(
        `supplier-daily-price-reminder: evaluated=${result.evaluated} notified=${result.notified} skippedComplete=${result.skippedComplete}`
      );
    } catch (error) {
      this.logger.error(
        "supplier-daily-price-reminder: failed",
        error instanceof Error ? error.stack : String(error)
      );
    }
  }
}
