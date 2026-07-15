import { Module } from "@nestjs/common";
import { SupplierModule } from "src/supplier/supplier.module";
import { ListingsModule } from "src/supplier/listings/listings.module";
import { OrdersModule } from "src/supplier/orders/orders.module";
import { RfqsModule } from "src/supplier/rfqs/rfqs.module";
import { SupplierReportsModule } from "src/supplier/reports/reports.module";
import { WhatsAppController } from "./whatsapp.controller";
import { TwilioWhatsAppController } from "./twilio-whatsapp.controller";
import { WhatsAppRouterService } from "./whatsapp-router.service";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { WhatsAppAuthService } from "./whatsapp-auth.service";
import { WhatsAppAuditHelper } from "./whatsapp-audit.helper";
import { WHATSAPP_SEND_PROVIDER } from "./adapters/whatsapp-send.interface";
import { MockWhatsAppSendAdapter } from "./adapters/mock-whatsapp-send.adapter";
import { MetaCloudApiSendAdapter } from "./adapters/meta-cloud-api-send.adapter";
import { TwilioSupplierSendAdapter } from "./adapters/twilio-supplier-send.adapter";

import { PriceUpdateFlow } from "./flows/price-update.flow";
import { EnquiryDecisionFlow } from "./flows/enquiry-decision.flow";
import { OrderStatusFlow } from "./flows/order-status.flow";
import { DailyReportFlow } from "./flows/daily-report.flow";

@Module({
  imports: [SupplierModule, ListingsModule, OrdersModule, RfqsModule, SupplierReportsModule],
  controllers: [WhatsAppController, TwilioWhatsAppController],
  providers: [
    WhatsAppRouterService,
    WhatsAppSessionService,
    WhatsAppAuthService,
    WhatsAppAuditHelper,
    PriceUpdateFlow,
    EnquiryDecisionFlow,
    OrderStatusFlow,
    DailyReportFlow,
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
  ],
})
export class WhatsAppModule {}
