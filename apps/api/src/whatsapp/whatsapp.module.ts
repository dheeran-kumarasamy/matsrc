import { Module } from "@nestjs/common";
import { SupplierModule } from "src/supplier/supplier.module";
import { ListingsModule } from "src/supplier/listings/listings.module";
import { OrdersModule } from "src/supplier/orders/orders.module";
import { RfqsModule } from "src/supplier/rfqs/rfqs.module";
import { SupplierReportsModule } from "src/supplier/reports/reports.module";
import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppRouterService } from "./whatsapp-router.service";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { WhatsAppAuthService } from "./whatsapp-auth.service";
import { WhatsAppAuditHelper } from "./whatsapp-audit.helper";
import { WHATSAPP_SEND_PROVIDER } from "./adapters/whatsapp-send.interface";
import { MockWhatsAppSendAdapter } from "./adapters/mock-whatsapp-send.adapter";
import { MetaCloudApiSendAdapter } from "./adapters/meta-cloud-api-send.adapter";

import { PriceUpdateFlow } from "./flows/price-update.flow";
import { EnquiryDecisionFlow } from "./flows/enquiry-decision.flow";
import { OrderStatusFlow } from "./flows/order-status.flow";
import { DailyReportFlow } from "./flows/daily-report.flow";
import { SupplierDailyPriceReplyFlow } from "./flows/supplier-daily-price-reply.flow";
import { NotificationEngineModule } from "../notification-engine/notification-engine.module";

@Module({
  imports: [SupplierModule, ListingsModule, OrdersModule, RfqsModule, SupplierReportsModule, NotificationEngineModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppRouterService,
    WhatsAppSessionService,
    WhatsAppAuthService,
    WhatsAppAuditHelper,
    PriceUpdateFlow,
    EnquiryDecisionFlow,
    OrderStatusFlow,
    DailyReportFlow,
    SupplierDailyPriceReplyFlow,
    MockWhatsAppSendAdapter,
    MetaCloudApiSendAdapter,
    {
      provide: WHATSAPP_SEND_PROVIDER,
      // Twilio supplier-bot adapter removed — Meta WhatsApp Cloud API
      // (WHATSAPP_ADAPTER=meta) is the only real send provider now; `mock`
      // remains the safe default for local/dev/test.
      useFactory: (mock: MockWhatsAppSendAdapter, meta: MetaCloudApiSendAdapter) => {
        switch (process.env.WHATSAPP_ADAPTER) {
          case "meta":
            return meta;
          default:
            return mock;
        }
      },
      inject: [MockWhatsAppSendAdapter, MetaCloudApiSendAdapter],
    },
  ],
})
export class WhatsAppModule {}
