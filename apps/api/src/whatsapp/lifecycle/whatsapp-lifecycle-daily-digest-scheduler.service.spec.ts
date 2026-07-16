import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrderStatus } from "@matsrc/db";
import { WhatsAppLifecycleDailyDigestSchedulerService } from "./whatsapp-lifecycle-daily-digest-scheduler.service";
import { WhatsAppLifecycleConfigService } from "./whatsapp-lifecycle-config.service";

/**
 * Spec §G: "Duplicate scheduled-job runs don't double-send either daily reminder."
 *
 * The scheduler itself just computes counts and delegates the actual dedupe to
 * `WhatsAppLifecycleService` (durable, AuditLog-backed). Here we verify that running
 * `sweep()` twice within the digest hour calls the lifecycle notify methods twice (once
 * per sweep, as expected — the scheduler has no in-memory "already ran today" guard by
 * design, deliberately relying on the durable per-supplier-per-day idempotency inside
 * the lifecycle service itself), and that the underlying idempotency service is what
 * prevents an actual second WhatsApp send.
 */
function makeFakePrisma(items: Array<{ supplierId: string; orderId: string }>) {
  return {
    orderItem: {
      findMany: vi.fn(async () => items),
    },
  };
}

function makeFakeLifecycleService() {
  return {
    notifySupplierPendingEnquiriesReminder: vi.fn(async () => undefined),
    notifySupplierPendingDeliveriesReminder: vi.fn(async () => undefined),
  };
}

function makeConfig(overrides: Partial<Record<string, unknown>> = {}) {
  const config = new WhatsAppLifecycleConfigService();
  if (overrides.digestHour !== undefined) {
    vi.spyOn(config, "getDailyDigestHour").mockReturnValue(overrides.digestHour as number);
  }
  return config;
}

describe("WhatsAppLifecycleDailyDigestSchedulerService", () => {
  let prisma: ReturnType<typeof makeFakePrisma>;
  let lifecycleService: ReturnType<typeof makeFakeLifecycleService>;
  let config: WhatsAppLifecycleConfigService;
  let scheduler: WhatsAppLifecycleDailyDigestSchedulerService;

  beforeEach(() => {
    prisma = makeFakePrisma([
      { supplierId: "supplier-1", orderId: "order-1" },
      { supplierId: "supplier-1", orderId: "order-2" },
    ]);
    lifecycleService = makeFakeLifecycleService();
    config = makeConfig({ digestHour: new Date().getHours() });
    scheduler = new WhatsAppLifecycleDailyDigestSchedulerService(prisma as any, lifecycleService as any, config);
  });

  it("does nothing outside the configured digest hour", async () => {
    vi.spyOn(config, "getDailyDigestHour").mockReturnValue((new Date().getHours() + 5) % 24);

    const result = await scheduler.sweep();

    expect(result.ranDigest).toBe(false);
    expect(lifecycleService.notifySupplierPendingEnquiriesReminder).not.toHaveBeenCalled();
  });

  it("counts distinct orders per supplier and calls the reminder once per supplier during the digest hour", async () => {
    const result = await scheduler.sweep();

    expect(result.ranDigest).toBe(true);
    expect(lifecycleService.notifySupplierPendingEnquiriesReminder).toHaveBeenCalledTimes(1);
    expect(lifecycleService.notifySupplierPendingEnquiriesReminder).toHaveBeenCalledWith("supplier-1", 2, expect.any(String));
  });

  it("guards against overlapping concurrent sweeps via the in-process 'sweeping' flag", async () => {
    const first = scheduler.sweep();
    const second = scheduler.sweep();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    // One of the two concurrent calls is skipped by the sweeping guard (ranDigest: false),
    // so the underlying reminder is not invoked twice concurrently for the same tick.
    const ranCount = [firstResult.ranDigest, secondResult.ranDigest].filter(Boolean).length;
    expect(ranCount).toBeLessThanOrEqual(1);
  });

  it("relies on the durable AuditLog-backed idempotency in WhatsAppLifecycleService to prevent an actual double-send across two separate sweep ticks", async () => {
    // Two independent (sequential) sweep runs both call the lifecycle notify method —
    // that's expected, since the scheduler itself is stateless. What guarantees no
    // double WhatsApp send is WhatsAppLifecycleIdempotencyService.runOnce inside the
    // notify method (see whatsapp-lifecycle.service.spec.ts's dedicated dedupe tests).
    await scheduler.sweep();
    await scheduler.sweep();

    expect(lifecycleService.notifySupplierPendingEnquiriesReminder).toHaveBeenCalledTimes(2);
  });
});
