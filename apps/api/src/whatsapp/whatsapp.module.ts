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

@Module({
  imports: [SupplierModule, ListingsModule, OrdersModule, RfqsModule, SupplierReportsModule],
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
    MockWhatsAppSendAdapter,
    MetaCloudApiSendAdapter,
    {
      provide: WHATSAPP_SEND_PROVIDER,
      useFactory: (mock: MockWhatsAppSendAdapter, meta: MetaCloudApiSendAdapter) =>
        process.env.WHATSAPP_ADAPTER === "meta" ? meta : mock,
      inject: [MockWhatsAppSendAdapter, MetaCloudApiSendAdapter],
    },
  ],
})
export class WhatsAppModule {}

