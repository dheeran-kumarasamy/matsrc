import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { isMandatoryEventType } from "./notification-event-types";

export type NotificationPolicyDecision =
  | { allowed: true; templateName: string; channel: string; priority: string }
  | { allowed: false; reason: PolicyDenialReason };

export type PolicyDenialReason =
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_DISABLED"
  | "CHANNEL_DISABLED_GLOBALLY"
  | "DAILY_LIMIT_REACHED"
  | "COOLDOWN_ACTIVE"
  | "OUTSIDE_BUSINESS_HOURS"
  | "DUPLICATE_DEDUPE_KEY"
  | "USER_OPTED_OUT";

/**
 * NotificationPolicyService — the ONLY gate a business-event call site is
 * allowed to pass through before a WhatsApp/In-App send is attempted (spec
 * Phase 3). Never call Meta (or any channel dispatcher) before this
 * returns `{ allowed: true }`.
 *
 * Responsibilities (spec Phase 3, items 1-10):
 *  1. Event enabled (NotificationEventPolicy.enabled)
 *  2. Channel enabled (per-policy, per-channel row)
 *  3. Global channel settings (NotificationGlobalSettings.whatsappBusinessEnabled)
 *  4. Priority (read-through, used by callers to decide urgency — never itself a block)
 *  5. Cooldown (NotificationEventPolicy.cooldownMinutes)
 *  6. Daily send limits (NotificationEventPolicy.maxPerDay)
 *  7. Business hours (NotificationEventPolicy.businessHoursOnly)
 *  8. Deduplication (dedupeKey uniqueness on NotificationEvent)
 *  9. User preferences (NotificationPreference.whatsappEnabled), where applicable
 *  10. Clear decision object — never throws for a policy denial.
 *
 * Mandatory authentication/security event types (see
 * notification-event-types.ts MANDATORY_EVENT_TYPES) always bypass #3 (the
 * global WhatsApp business kill-switch) and #9 (user opt-out) — per spec
 * Phase 6/8, security notifications must never be silently disabled by a
 * business decision.
 */
@Injectable()
export class NotificationPolicyService {
  private readonly logger = new Logger(NotificationPolicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async evaluate(params: {
    eventType: string;
    channel: string;
    recipientId?: string;
    dedupeKey?: string;
    businessHourWindow?: { startHour: number; endHour: number }; // server-local hours, 0-23
  }): Promise<NotificationPolicyDecision> {
    const { eventType, channel } = params;
    const mandatory = isMandatoryEventType(eventType);

    const policy = await this.prisma.notificationEventPolicy.findUnique({
      where: { eventType_channel: { eventType, channel } },
    });

    if (!policy) {
      return { allowed: false, reason: "TEMPLATE_NOT_FOUND" };
    }

    if (!policy.enabled) {
      return { allowed: false, reason: "TEMPLATE_DISABLED" };
    }

    if (!mandatory && channel === "WHATSAPP") {
      const global = await this.prisma.notificationGlobalSettings.findUnique({ where: { id: "global" } });
      if (global && !global.whatsappBusinessEnabled) {
        return { allowed: false, reason: "CHANNEL_DISABLED_GLOBALLY" };
      }
    }

    if (!mandatory && params.recipientId && channel === "WHATSAPP") {
      const preference = await this.prisma.notificationPreference.findUnique({
        where: { userId: params.recipientId },
      });
      if (preference && preference.whatsappEnabled === false) {
        return { allowed: false, reason: "USER_OPTED_OUT" };
      }
    }

    if (policy.businessHoursOnly) {
      const window = params.businessHourWindow ?? { startHour: 9, endHour: 19 };
      const currentHour = new Date().getHours();
      if (currentHour < window.startHour || currentHour >= window.endHour) {
        return { allowed: false, reason: "OUTSIDE_BUSINESS_HOURS" };
      }
    }

    if (params.dedupeKey) {
      const existing = await this.prisma.notificationEvent.findUnique({
        where: { dedupeKey: params.dedupeKey },
      });
      if (existing) {
        return { allowed: false, reason: "DUPLICATE_DEDUPE_KEY" };
      }
    }

    if (policy.maxPerDay !== null && policy.maxPerDay !== undefined && params.recipientId) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const sentToday = await this.prisma.notificationEvent.count({
        where: {
          eventType,
          recipientId: params.recipientId,
          channel,
          status: { in: ["sent", "created"] },
          createdAt: { gte: startOfDay },
        },
      });
      if (sentToday >= policy.maxPerDay) {
        return { allowed: false, reason: "DAILY_LIMIT_REACHED" };
      }
    }

    if (policy.cooldownMinutes && params.recipientId) {
      const cooldownStart = new Date(Date.now() - policy.cooldownMinutes * 60 * 1000);
      const recentSend = await this.prisma.notificationEvent.findFirst({
        where: {
          eventType,
          recipientId: params.recipientId,
          channel,
          createdAt: { gte: cooldownStart },
        },
        orderBy: { createdAt: "desc" },
      });
      if (recentSend) {
        return { allowed: false, reason: "COOLDOWN_ACTIVE" };
      }
    }

    return { allowed: true, templateName: policy.templateName, channel: policy.channel, priority: policy.priority };
  }
}
