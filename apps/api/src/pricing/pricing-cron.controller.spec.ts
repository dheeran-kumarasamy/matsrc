import { describe, expect, it, vi } from "vitest";
import { PricingCronController } from "./pricing-cron.controller";
import { CronSecretGuard } from "./cron-secret.guard";
import { UnauthorizedException } from "@nestjs/common";

function makeScheduler() {
  return {
    runIngestionJob: vi.fn(async (options?: { dryRun?: boolean }) => ({
      ok: true,
      job: "pricing-ingest",
      dryRun: options?.dryRun ?? false,
      discovered: 2,
      eligible: 1,
      due: 1,
      started: 1,
      succeeded: 1,
      failed: 0,
      skipped: 1,
    })),
    runNormalizationJob: vi.fn(async (options?: { dryRun?: boolean }) => ({
      ok: true,
      job: "pricing-normalize",
      dryRun: options?.dryRun ?? false,
      rawCandidates: 5,
      processed: 5,
      parsed: 5,
      unmapped: 0,
      quarantined: 0,
      rejected: 0,
      endpointsProcessed: 1,
    })),
    runDailyJobs: vi.fn(async () => undefined),
    runMonthlyJob: vi.fn(async () => undefined),
  };
}

describe("PricingCronController", () => {
  it("runIngest() invokes PricingSchedulerService.runIngestionJob() and forwards dryRun query param", async () => {
    const scheduler = makeScheduler();
    const controller = new PricingCronController(scheduler as any);

    const result = await controller.runIngest("true");

    expect(scheduler.runIngestionJob).toHaveBeenCalledWith({ dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
  });

  it("runNormalize() invokes PricingSchedulerService.runNormalizationJob() and forwards dryRun query param", async () => {
    const scheduler = makeScheduler();
    const controller = new PricingCronController(scheduler as any);

    const result = await controller.runNormalize("false");

    expect(scheduler.runNormalizationJob).toHaveBeenCalledWith({ dryRun: false });
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(false);
  });

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

describe("CronSecretGuard", () => {
  const guard = new CronSecretGuard();

  it("rejects unauthenticated cron request when CRON_SECRET is not configured or header missing", () => {
    const origSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;

    const mockCtx = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as any;

    expect(() => guard.canActivate(mockCtx)).toThrow(UnauthorizedException);

    process.env.CRON_SECRET = origSecret;
  });

  it("rejects request with invalid bearer token", () => {
    const origSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "supersecret123";

    const mockCtx = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: "Bearer wrongtoken" } }),
      }),
    } as any;

    expect(() => guard.canActivate(mockCtx)).toThrow(UnauthorizedException);

    process.env.CRON_SECRET = origSecret;
  });

  it("allows request with valid bearer token matching CRON_SECRET", () => {
    const origSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "supersecret123";

    const mockCtx = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: "Bearer supersecret123" } }),
      }),
    } as any;

    expect(guard.canActivate(mockCtx)).toBe(true);

    process.env.CRON_SECRET = origSecret;
  });
});
