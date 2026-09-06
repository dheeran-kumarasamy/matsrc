import { Controller, Get, Logger, UseGuards } from "@nestjs/common";
import { CronSecretGuard } from "src/pricing/cron-secret.guard";
import { SupplierDailyPriceReminderService } from "./supplier-daily-price-reminder.service";

/**
 * HTTP-triggerable equivalent of `SupplierDailyPriceSchedulerService`'s
 * @Cron method, for the same reason `PricingCronController` exists (see
 * that file's doc comment) — apps/api runs as a Vercel serverless function
 * with no long-lived process for @nestjs/schedule's in-memory timers.
 * Reuses the existing `CronSecretGuard` (CRON_SECRET-backed) rather than
 * introducing a second cron-auth mechanism.
 *
 * To actually run on a schedule in production, add an entry to
 * apps/api/vercel.json's `crons` array, e.g.:
 *   { "path": "/api/notification-engine/cron/supplier-daily-price", "schedule": "0 10 * * *" }
 */
@Controller("notification-engine/cron")
@UseGuards(CronSecretGuard)
export class SupplierDailyPriceCronController {
  private readonly logger = new Logger(SupplierDailyPriceCronController.name);

  constructor(private readonly reminder: SupplierDailyPriceReminderService) {}

  @Get("supplier-daily-price")
  async run() {
    this.logger.log("run: triggered via Vercel Cron Job");
    const result = await this.reminder.evaluateAndNotify();
    return { ok: true, job: "supplier-daily-price-reminder", ...result };
  }
}
