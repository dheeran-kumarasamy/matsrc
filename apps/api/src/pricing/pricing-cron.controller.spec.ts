import { describe, expect, it, vi } from "vitest";
import { PricingCronController } from "./pricing-cron.controller";

/**
 * PricingCronController deliberately contains no business logic of its own
 * — it only calls straight through to PricingSchedulerService's existing,
 * already-tested runDailyJobs()/runMonthlyJob() methods (see
 * pricing-scheduler.service.ts). These tests assert only that pass-through
 * wiring, not the underlying job logic itself.
 */
function makeScheduler() {
  return {
    runDailyJobs: vi.fn(async () => undefined),
    runMonthlyJob: vi.fn(async () => undefined),
  };
}

describe("PricingCronController", () => {
  it("runDaily() invokes PricingSchedulerService.runDailyJobs() and returns ok", async () => {
    const scheduler = makeScheduler();
    const controller = new PricingCronController(scheduler as any);

    const result = await controller.runDaily();

    expect(scheduler.runDailyJobs).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, job: "pricing-daily-rollup" });
  });

  it("runMonthly() invokes PricingSchedulerService.runMonthlyJob() and returns ok", async () => {
    const scheduler = makeScheduler();
    const controller = new PricingCronController(scheduler as any);

    const result = await controller.runMonthly();

    expect(scheduler.runMonthlyJob).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, job: "pricing-monthly-rollup" });
  });
});
