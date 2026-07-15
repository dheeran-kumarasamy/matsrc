import { Module } from "@nestjs/common";
import { MockWhatsAppProvider } from "./adapters/mock-whatsapp.provider";
import { NotificationQueueService } from "./notification.queue";
import { NotificationProcessor } from "./notification.processor";
import { NotificationService } from "./notification.service";
import { NOTIFICATION_PROVIDER } from "./notification.types";
import { WhatsAppAlertsModule } from "./whatsapp-alerts/whatsapp-alerts.module";

@Module({
  imports: [WhatsAppAlertsModule],
  providers: [
    NotificationQueueService,
    NotificationService,
    NotificationProcessor,
    MockWhatsAppProvider,
    {
      provide: NOTIFICATION_PROVIDER,
      useExisting: MockWhatsAppProvider,
    },
  ],
  exports: [NotificationService, WhatsAppAlertsModule],
})
export class NotificationsModule {}
