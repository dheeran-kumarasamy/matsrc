import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { OrderStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { WhatsAppLifecycleConfigService } from "./whatsapp-lifecycle-config.service";
import { WhatsAppLifecycleService } from "./whatsapp-lifecycle.service";

/**
 * Runs a daily per-supplier digest sweep that sends (at most once per
 * supplier per day, per digest type):
 *  - `supplier_pending_enquiries_reminder` — count of distinct orders in
 *    OrderStatus.PLACED that have at least one OrderItem for the supplier.
 *  - `supplier_pending_deliveries_reminder` — count of distinct orders in
 *    OrderStatus.PROCESSING / DISPATCHED / OUT_FOR_DELIVERY that have at
 *    least one OrderItem for the supplier (i.e. accepted but not yet
 *    delivered).
 *
 * Both sends are additionally deduped inside
 * `WhatsAppLifecycleService`/`WhatsAppLifecycleIdempotencyService` via a
 * durable AuditLog-backed key that includes the supplierId + dateKey, so
 * even if this sweep runs more than once within the target hour (or the
 * process restarts), at most one message per supplier per digest per day
 * is ever sent.
 *
 * Modeled directly on `AggregationSchedulerService`
 * (apps/api/src/aggregation/aggregation-scheduler.service.ts).
 */
@Injectable()
export class WhatsAppLifecycleDailyDigestSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppLifecycleDailyDigestSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: WhatsAppLifecycleService,
    private readonly config: WhatsAppLifecycleConfigService,
  ) {}

  onModuleInit(): void {
    if (process.env.WHATSAPP_LIFECYCLE_SWEEP_DISABLED === "true") {
      return;
    }
    const intervalMs = this.config.getDailyDigestSweepIntervalMs();
    this.timer = setInterval(() => {
      void this.sweep();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Sweep is interval-driven but only actually sends during the configured
   * digest hour (server-local time). The interval simply controls how
   * frequently we check the clock; durable idempotency (dateKey-scoped)
   * guarantees at most one send per supplier per day regardless of how many
   * times the sweep fires during that hour.
   */
  async sweep(): Promise<{ ranDigest: boolean; enquiriesNotified: number; deliveriesNotified: number }> {
    if (!this.config.isEnabled()) {
      return { ranDigest: false, enquiriesNotified: 0, deliveriesNotified: 0 };
    }
    if (this.sweeping) {
      return { ranDigest: false, enquiriesNotified: 0, deliveriesNotified: 0 };
    }
    const now = new Date();
    if (now.getHours() !== this.config.getDailyDigestHour()) {
      return { ranDigest: false, enquiriesNotified: 0, deliveriesNotified: 0 };
    }

    this.sweeping = true;
    try {
      const dateKey = now.toISOString().slice(0, 10);

      const [pendingEnquiryCounts, pendingDeliveryCounts] = await Promise.all([
        this.countDistinctOrdersPerSupplier([OrderStatus.PLACED]),
        this.countDistinctOrdersPerSupplier([
          OrderStatus.PROCESSING,
          OrderStatus.DISPATCHED,
          OrderStatus.OUT_FOR_DELIVERY,
        ]),
      ]);

      let enquiriesNotified = 0;
      for (const [supplierId, count] of pendingEnquiryCounts.entries()) {
        if (count <= 0) continue;
        try {
          await this.lifecycleService.notifySupplierPendingEnquiriesReminder(supplierId, count, dateKey);
          enquiriesNotified += 1;
        } catch (err) {
          this.logger.warn(
            `Failed to send pending-enquiries digest for supplier ${supplierId}: ${(err as Error).message}`,
          );
        }
      }

      let deliveriesNotified = 0;
      for (const [supplierId, count] of pendingDeliveryCounts.entries()) {
        if (count <= 0) continue;
        try {
          await this.lifecycleService.notifySupplierPendingDeliveriesReminder(supplierId, count, dateKey);
          deliveriesNotified += 1;
        } catch (err) {
          this.logger.warn(
            `Failed to send pending-deliveries digest for supplier ${supplierId}: ${(err as Error).message}`,
          );
        }
      }

      return { ranDigest: true, enquiriesNotified, deliveriesNotified };
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Returns a map of supplierId -> distinct order count, for orders whose
   * status is one of `statuses` and that have at least one OrderItem
   * belonging to that supplier.
   */
  private async countDistinctOrdersPerSupplier(statuses: OrderStatus[]): Promise<Map<string, number>> {
    const items = await this.prisma.orderItem.findMany({
      where: { order: { status: { in: statuses } } },
      select: { supplierId: true, orderId: true },
    });

    const seenPerSupplier = new Map<string, Set<string>>();
    for (const item of items) {
      const set = seenPerSupplier.get(item.supplierId) ?? new Set<string>();
      set.add(item.orderId);
      seenPerSupplier.set(item.supplierId, set);
    }

    const counts = new Map<string, number>();
    for (const [supplierId, orderIds] of seenPerSupplier.entries()) {
      counts.set(supplierId, orderIds.size);
    }
    return counts;
  }
}
