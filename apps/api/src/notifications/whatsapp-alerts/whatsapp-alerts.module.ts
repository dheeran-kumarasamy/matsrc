import { Module } from "@nestjs/common";
import { WhatsAppAlertConfigService } from "./whatsapp-alert-config.service";
import { TwilioWhatsAppProvider } from "./twilio-whatsapp.provider";
import { WhatsAppAlertService } from "./whatsapp-alert.service";
import { WhatsAppStatusController } from "./whatsapp-status.controller";
import { WHATSAPP_ALERT_PROVIDER } from "./whatsapp-alert-provider.interface";

/**
 * Wires the outbound WhatsApp business-alert feature (watchlist price hits,
 * order-status updates, RFQ quote-received notices).
 *
 * Follows the same DI-factory pattern as `apps/api/src/whatsapp/whatsapp.module.ts`
 * (the pre-existing, unrelated Supplier WhatsApp bot module) — the `WHATSAPP_PROVIDER`
 * env var selects the concrete `WhatsAppProvider` implementation bound to the
 * `WHATSAPP_ALERT_PROVIDER` token. Today only Twilio is implemented; adding Meta later
 * means adding a new provider class here and extending the factory's switch — no
 * business-logic call site changes.
 */
@Module({
  controllers: [WhatsAppStatusController],
  providers: [
    WhatsAppAlertConfigService,
    TwilioWhatsAppProvider,
    WhatsAppAlertService,
    {
      provide: WHATSAPP_ALERT_PROVIDER,
      useFactory: (twilio: TwilioWhatsAppProvider, config: WhatsAppAlertConfigService) => {
        // `config.getProvider()` returns "twilio" today; a future "meta" branch would
        // return a new `MetaWhatsAppAlertProvider` instance injected the same way.
        void config.getProvider();
        return twilio;
      },
      inject: [TwilioWhatsAppProvider, WhatsAppAlertConfigService],
    },
  ],
  exports: [WhatsAppAlertService],
})
export class WhatsAppAlertsModule {}
