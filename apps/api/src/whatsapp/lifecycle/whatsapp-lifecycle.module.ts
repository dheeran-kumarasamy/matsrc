import { Module } from "@nestjs/common";
import { WHATSAPP_SEND_PROVIDER } from "../adapters/whatsapp-send.interface";
import { MockWhatsAppSendAdapter } from "../adapters/mock-whatsapp-send.adapter";
import { MetaCloudApiSendAdapter } from "../adapters/meta-cloud-api-send.adapter";
import { TwilioSupplierSendAdapter } from "../adapters/twilio-supplier-send.adapter";
import { WhatsAppAuditHelper } from "../whatsapp-audit.helper";
import { WhatsAppLifecycleConfigService } from "./whatsapp-lifecycle-config.service";
import { WhatsAppLifecycleIdempotencyService } from "./whatsapp-lifecycle-idempotency.service";
import { WhatsAppLifecycleService } from "./whatsapp-lifecycle.service";
import { WhatsAppLifecycleEnquiryNudgeSchedulerService } from "./whatsapp-lifecycle-enquiry-nudge-scheduler.service";
import { WhatsAppLifecycleDailyDigestSchedulerService } from "./whatsapp-lifecycle-daily-digest-scheduler.service";

/**
 * Standalone module for outbound order/enquiry-lifecycle WhatsApp notifications
 * (Builder + Supplier Utility templates — spec §A-D). Deliberately does NOT import
 * `WhatsAppModule` (the inbound supplier-bot module) to avoid a circular
 * import — `WhatsAppModule` already imports `OrdersModule` (supplier), and
 * `OrdersModule` needs `WhatsAppLifecycleService` to fire status-transition
 * notifications, which would create `WhatsAppModule` -> `OrdersModule` ->
 * `WhatsAppLifecycleModule` -> `WhatsAppModule` (circular).
 *
 * Instead this module re-provides the same `WHATSAPP_SEND_PROVIDER` factory and
 * `WhatsAppAuditHelper` directly (mirroring `whatsapp.module.ts`'s wiring exactly),
 * so both modules share the identical adapter-selection behavior (env
 * `WHATSAPP_ADAPTER`) and the same `AuditLog`-backed audit trail, without either
 * module depending on the other.
 */
@Module({
  providers: [
    WhatsAppAuditHelper,
    MockWhatsAppSendAdapter,
    MetaCloudApiSendAdapter,
    TwilioSupplierSendAdapter,
    {
      provide: WHATSAPP_SEND_PROVIDER,
      useFactory: (mock: MockWhatsAppSendAdapter, meta: MetaCloudApiSendAdapter, twilio: TwilioSupplierSendAdapter) => {
        switch (process.env.WHATSAPP_ADAPTER) {
          case "meta":
            return meta;
          case "twilio":
            return twilio;
          default:
            return mock;
        }
      },
      inject: [MockWhatsAppSendAdapter, MetaCloudApiSendAdapter, TwilioSupplierSendAdapter],
    },
    WhatsAppLifecycleConfigService,
    WhatsAppLifecycleIdempotencyService,
    WhatsAppLifecycleService,
    WhatsAppLifecycleEnquiryNudgeSchedulerService,
    WhatsAppLifecycleDailyDigestSchedulerService,
  ],
  exports: [WhatsAppLifecycleService, WhatsAppLifecycleConfigService],
})
export class WhatsAppLifecycleModule {}
