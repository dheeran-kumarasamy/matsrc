import { Injectable } from "@nestjs/common";
import { WhatsappNotificationService } from "../whatsapp/whatsapp-notification.service";
import { NotificationChannel, NotificationPayload, NotificationResult } from "./notification-channel.interface";

/**
 * WhatsAppNotificationChannel — thin adapter binding the generic
 * `NotificationChannel` interface (spec Phase 4) to
 * `WhatsappNotificationService` (spec Phase 5/6, the actual Meta Cloud API
 * transport + dry-run/mock mode).
 */
@Injectable()
export class WhatsAppEngineChannel implements NotificationChannel {
  constructor(private readonly whatsapp: WhatsappNotificationService) {}

  async send(notification: NotificationPayload): Promise<NotificationResult> {
    if (!notification.phone) {
      return { success: false, error: "NO_PHONE_NUMBER" };
    }

    const result = await this.whatsapp.sendTemplateAlert(notification.phone, notification.templateName, notification.parameters);

    return {
      success: result.status === "sent",
      externalId: result.metaMessageId,
      error: result.errorDetails,
    };
  }
}
