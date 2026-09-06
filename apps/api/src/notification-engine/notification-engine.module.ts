import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { NotificationPolicyService } from "./notification-policy.service";
import { NotificationEngineService } from "./notification-engine.service";
import { WhatsAppEngineConfigService } from "./whatsapp/whatsapp-engine-config.service";
import { WhatsappNotificationService } from "./whatsapp/whatsapp-notification.service";
import { WhatsAppWebhookStatusProcessorService } from "./whatsapp/whatsapp-webhook-status-processor.service";
import { WhatsAppEngineChannel } from "./channels/whatsapp-engine-channel.service";
import { InAppEngineChannel } from "./channels/in-app-engine-channel.service";
import { SupplierDailyPriceCompletenessService } from "./supplier-daily-price/supplier-daily-price-completeness.service";
import { SupplierDailyPriceReminderService } from "./supplier-daily-price/supplier-daily-price-reminder.service";
import { SupplierDailyPriceSchedulerService } from "./supplier-daily-price/supplier-daily-price-scheduler.service";
import { SupplierDailyPriceCronController } from "./supplier-daily-price/supplier-daily-price-cron.controller";
import { CronSecretGuard } from "src/pricing/cron-secret.guard";

/**
 * Wires the whole Buildohub Notification Engine (channel-agnostic core +
 * WhatsApp channel + supplier daily price completeness workflow).
 *
 * `WhatsAppWebhookStatusProcessorService` is exported so `WhatsAppModule`
 * (the pre-existing Supplier bot module, which owns the actual
 * `whatsapp/webhook` HTTP route) can inject it without this module needing
 * to know anything about the inbound webhook controller — keeps this
 * module's only public HTTP surface to the notification-engine-owned admin
 * + cron controllers.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [SupplierDailyPriceCronController],
  providers: [
    CronSecretGuard,
    NotificationPolicyService,
    NotificationEngineService,
    WhatsAppEngineConfigService,
    WhatsappNotificationService,
    WhatsAppWebhookStatusProcessorService,
    WhatsAppEngineChannel,
    InAppEngineChannel,
    SupplierDailyPriceCompletenessService,
    SupplierDailyPriceReminderService,
    SupplierDailyPriceSchedulerService,
  ],
  exports: [
    NotificationPolicyService,
    NotificationEngineService,
    WhatsAppEngineConfigService,
    WhatsappNotificationService,
    WhatsAppWebhookStatusProcessorService,
    SupplierDailyPriceCompletenessService,
    SupplierDailyPriceReminderService,
  ],
})
export class NotificationEngineModule {}
