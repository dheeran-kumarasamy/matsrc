import { Module } from "@nestjs/common";
import { MockWhatsAppProvider } from "./adapters/mock-whatsapp.provider";
import { NotificationQueueService } from "./notification.queue";
import { NotificationProcessor } from "./notification.processor";
import { NotificationService } from "./notification.service";
import { NOTIFICATION_PROVIDER } from "./notification.types";

@Module({
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
  exports: [NotificationService],
})
export class NotificationsModule {}