import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { OrderStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { WhatsAppLifecycleConfigService } from "./whatsapp-lifecycle-config.service";
import { WhatsAppLifecycleService } from "./whatsapp-lifecycle.service";

/**
 * Periodically sweeps for orders/enquiries that have been sitting in PLACED
 * status for longer than the configured nudge threshold, and sends the
 * `builder_enquiry_pending_update` WhatsApp template to the builder exactly
 * once per enquiry (guarded by `Order.reminderSentAt`, set inside
 * `WhatsAppLifecycleService.notifyBuilderEnquiryPendingUpdate`).
 *
 * Modeled directly on `AggregationSchedulerService`
 * (apps/api/src/aggregation/aggregation-scheduler.service.ts).
 */
@Injectable()
export class WhatsAppLifecycleEnquiryNudgeSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppLifecycleEnquiryNudgeSchedulerService.name);
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
    const intervalMs = this.config.getEnquiryNudgeSweepIntervalMs();
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

  async sweep(): Promise<{ checked: number; notified: number }> {
    if (!this.config.isEnabled()) {
      return { checked: 0, notified: 0 };
    }
    if (this.sweeping) {
      return { checked: 0, notified: 0 };
    }
    this.sweeping = true;
    try {
      const thresholdHours = this.config.getEnquiryNudgeThresholdHours();
      const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

      const candidates = await this.prisma.order.findMany({
        where: {
          status: OrderStatus.PLACED,
          reminderSentAt: null,
          createdAt: { lte: cutoff },
        },
        select: { id: true },
      });

      let notified = 0;
      for (const order of candidates) {
        try {
          await this.lifecycleService.notifyBuilderEnquiryPendingUpdate(order.id);
          notified += 1;
        } catch (err) {
          this.logger.warn(`Failed to send enquiry pending nudge for order ${order.id}: ${(err as Error).message}`);
        }
      }

      return { checked: candidates.length, notified };
    } finally {
      this.sweeping = false;
    }
  }
}
