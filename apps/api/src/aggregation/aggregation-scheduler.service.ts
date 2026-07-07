import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AggregationPoolStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { AggregationConfigService } from "./aggregation-config.service";
import { AggregationService } from "./aggregation.service";

/**
 * AggregationSchedulerService — sweeps OPEN AggregationPool rows and locks any pool
 * whose window has closed (windowCloseAt <= now) OR whose currentQuantity has reached
 * the highest configured price tier's minQty ("max tier reached"), whichever comes first.
 *
 * There is no existing cron/queue-scheduler infra in this repo for periodic sweeps
 * (BullMQ is only used for notification delivery jobs), so this follows the same
 * lightweight OnModuleInit/OnModuleDestroy provider pattern used by
 * NotificationQueueService/NotificationProcessor, using a plain `setInterval` instead
 * of introducing a new scheduling dependency.
 *
 * Gated by AggregationConfigService.isEnabled() — when the feature flag is off, the
 * sweep is a no-op (existing OPEN pools are left untouched, matching the "supplier
 * disables aggregation but open pools complete under original terms" edge case; the
 * platform-wide flag additionally freezes sweeping so nothing auto-locks while the
 * feature is toggled off).
 */
@Injectable()
export class AggregationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AggregationSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregationService: AggregationService,
    private readonly aggregationConfig: AggregationConfigService
  ) {}

  onModuleInit() {
    // Tests / CLI tooling can opt out of the interval entirely.
    if (process.env.AGGREGATION_SWEEP_DISABLED === "true") {
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.timer = setInterval(() => {
      void this.sweep();
    }, intervalMs);

    // Allow the Node process to exit even if the interval is pending (useful for tests/CLI).
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getIntervalMs(): number {
    const raw = process.env.AGGREGATION_SWEEP_INTERVAL_MS;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 60 * 1000; // default: 5 minutes
  }

  /**
   * Finds every OPEN pool that is due to lock (window closed or max tier reached) and
   * locks each one. Safe to call concurrently/repeatedly: `lockPool` is idempotent and
   * each pool lock runs inside its own row-locked transaction, so overlapping sweeps
   * (or a sweep racing an immediate post-addParticipant lock check) cannot double-lock
   * or oversell a tier.
   */
  async sweep(): Promise<{ checked: number; locked: number }> {
    if (!this.aggregationConfig.isEnabled()) {
      return { checked: 0, locked: 0 };
    }

    if (this.sweeping) {
      // Avoid overlapping sweeps if a previous run is still in-flight (e.g. slow DB).
      return { checked: 0, locked: 0 };
    }

    this.sweeping = true;
    try {
      const now = new Date();
      const openPools = await this.prisma.aggregationPool.findMany({
        where: { status: AggregationPoolStatus.OPEN },
        select: { id: true, windowCloseAt: true, currentQuantity: true, priceTiers: true },
      });

      const due = openPools.filter((pool) => this.isDueForLock(pool, now));

      let locked = 0;
      for (const pool of due) {
        try {
          await this.aggregationService.lockPool(pool.id);
          locked += 1;
        } catch (error) {
          this.logger.warn(
            `Failed to auto-lock aggregation pool ${pool.id}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return { checked: openPools.length, locked };
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Checks a single pool immediately (e.g. right after addParticipant) and locks it if
   * it has just crossed the max tier threshold. Time-based expiry for this pool will
   * otherwise be caught by the next periodic sweep.
   */
  async checkImmediateLock(poolId: string): Promise<void> {
    if (!this.aggregationConfig.isEnabled()) {
      return;
    }

    const pool = await this.prisma.aggregationPool.findUnique({
      where: { id: poolId },
      select: { id: true, status: true, windowCloseAt: true, currentQuantity: true, priceTiers: true },
    });

    if (!pool || pool.status !== AggregationPoolStatus.OPEN) {
      return;
    }

    if (this.isDueForLock(pool, new Date())) {
      try {
        await this.aggregationService.lockPool(pool.id);
      } catch (error) {
        this.logger.warn(
          `Failed to immediately lock aggregation pool ${pool.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  private isDueForLock(
    pool: { windowCloseAt: Date; currentQuantity: number; priceTiers: unknown },
    now: Date
  ): boolean {
    if (pool.windowCloseAt <= now) {
      return true;
    }

    const maxTierMinQty = this.getMaxTierMinQty(pool.priceTiers);
    return maxTierMinQty !== null && pool.currentQuantity >= maxTierMinQty;
  }

  private getMaxTierMinQty(raw: unknown): number | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return null;
      }

      const minQtys = parsed
        .map((tier: any) => Number(tier?.minQty))
        .filter((value) => Number.isFinite(value));

      if (!minQtys.length) {
        return null;
      }

      return Math.max(...minQtys);
    } catch {
      return null;
    }
  }
}
