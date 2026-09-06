import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationPolicyService } from "./notification-policy.service";
import { WhatsAppEngineChannel } from "./channels/whatsapp-engine-channel.service";
import { InAppEngineChannel } from "./channels/in-app-engine-channel.service";
import { NotificationChannel as ChannelInterface } from "./channels/notification-channel.interface";

export type DispatchNotificationParams = {
  eventType: string;
  recipientId: string;
  recipientType: "builder" | "supplier" | "user";
  entityType?: string;
  entityId?: string;
  phone?: string | null;
  parameters?: string[];
  deepLink?: string;
  title?: string;
  body?: string;
  dedupeKey?: string;
  payload?: Record<string, unknown>;
};

export type DispatchNotificationResult = {
  eventId: string;
  channel: string | null;
  allowed: boolean;
  reason?: string;
  sendResult?: { success: boolean; externalId?: string; error?: string };
};

/**
 * NotificationEngineService — the single orchestration entry point for the
 * whole Buildohub Notification Engine (spec architecture diagram):
 *
 *   Business Event -> Notification Engine -> Notification Policy ->
 *   Template Registry -> Channel Dispatcher -> WhatsApp/In-App ->
 *   Delivery Log -> Webhook/status updates
 *
 * Every business-event call site (RFQ/PO/dispatch/price-update/etc) should
 * call `dispatch()` exactly once per logical event — never call
 * `WhatsappNotificationService` or `NotificationPolicyService` directly from
 * business logic. This is the ONLY place that creates a `NotificationEvent`
 * row and decides which channel(s) to fan out to.
 *
 * Never throws to callers — every failure is captured in the returned
 * result so a notification-engine bug can never affect the underlying
 * business operation it was triggered from (same contract as
 * `WhatsAppAlertService.sendGated` / `WhatsAppLifecycleService`).
 */
@Injectable()
export class NotificationEngineService {
  private readonly logger = new Logger(NotificationEngineService.name);

  private readonly channels: Record<string, ChannelInterface>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: NotificationPolicyService,
    private readonly whatsAppChannel: WhatsAppEngineChannel,
    private readonly inAppChannel: InAppEngineChannel
  ) {
    this.channels = {
      WHATSAPP: this.whatsAppChannel,
      IN_APP: this.inAppChannel,
    };
  }

  async dispatch(params: DispatchNotificationParams, channel: string = "WHATSAPP"): Promise<DispatchNotificationResult> {
    try {
      const decision = await this.policy.evaluate({
        eventType: params.eventType,
        channel,
        recipientId: params.recipientId,
        dedupeKey: params.dedupeKey,
      });

      if (!decision.allowed) {
        const event = await this.prisma.notificationEvent.create({
          data: {
            eventType: params.eventType,
            recipientId: params.recipientId,
            recipientType: params.recipientType,
            entityType: params.entityType,
            entityId: params.entityId,
            channel,
            payload: (params.payload ?? {}) as any,
            status: "suppressed",
            suppressReason: decision.reason,
            // Do not persist a dedupeKey for a suppressed event — otherwise a
            // transient suppression (e.g. cooldown) would permanently block
            // every future dedupe-keyed attempt via the unique constraint.
          },
        });
        this.logger.debug(`dispatch: suppressed eventType=${params.eventType} reason=${decision.reason}`);
        return { eventId: event.id, channel, allowed: false, reason: decision.reason };
      }

      const event = await this.prisma.notificationEvent.create({
        data: {
          eventType: params.eventType,
          recipientId: params.recipientId,
          recipientType: params.recipientType,
          entityType: params.entityType,
          entityId: params.entityId,
          priority: decision.priority,
          channel,
          dedupeKey: params.dedupeKey,
          payload: (params.payload ?? {}) as any,
          status: "created",
        },
      });

      const dispatcher = this.channels[channel];
      if (!dispatcher) {
        await this.prisma.notificationEvent.update({ where: { id: event.id }, data: { status: "failed" } });
        return { eventId: event.id, channel, allowed: true, reason: "UNKNOWN_CHANNEL" };
      }

      const sendResult = await dispatcher.send({
        recipientId: params.recipientId,
        phone: params.phone,
        templateName: decision.templateName,
        parameters: params.parameters ?? [],
        deepLink: params.deepLink,
        title: params.title,
        body: params.body,
      });

      await this.prisma.notificationEvent.update({
        where: { id: event.id },
        data: { status: sendResult.success ? "sent" : "failed" },
      });

      return { eventId: event.id, channel, allowed: true, sendResult };
    } catch (error) {
      this.logger.error(
        `dispatch: unexpected error for eventType=${params.eventType}: ${error instanceof Error ? error.message : String(error)}`
      );
      return { eventId: "", channel, allowed: false, reason: "INTERNAL_ERROR" };
    }
  }

  /** Marks a previously-created NotificationEvent as resolved (e.g. supplier completed the required action) so no further reminders fire. */
  async resolve(dedupeKey: string): Promise<void> {
    await this.prisma.notificationEvent
      .updateMany({ where: { dedupeKey }, data: { status: "resolved", resolvedAt: new Date() } })
      .catch(() => undefined);
  }
}
