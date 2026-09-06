import { Injectable } from "@nestjs/common";
import { NotificationChannel as PrismaNotificationChannel } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationChannel, NotificationPayload, NotificationResult } from "./notification-channel.interface";

/**
 * InAppNotificationChannel — Phase 4/14. Reuses the EXISTING `Notification`
 * Prisma model (already the backing store for the in-app/toast notification
 * UI — see NotificationService) rather than introducing a second, competing
 * in-app notification framework. Every send here is `channel: IN_APP`,
 * `read: false`, with `templateType` left null since these are engine-driven
 * (dynamic title/body), not one of the pre-existing
 * `NotificationTemplateType` enum values.
 */
@Injectable()
export class InAppEngineChannel implements NotificationChannel {
  constructor(private readonly prisma: PrismaService) {}

  async send(notification: NotificationPayload): Promise<NotificationResult> {
    try {
      const created = await this.prisma.notification.create({
        data: {
          userId: notification.recipientId,
          channel: PrismaNotificationChannel.IN_APP,
          title: notification.title ?? notification.templateName,
          body: notification.body ?? notification.parameters.join(" "),
          status: "sent",
          variables: JSON.stringify({ deepLink: notification.deepLink ?? null }),
        },
      });
      return { success: true, externalId: created.id };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Failed to create in-app notification" };
    }
  }
}
