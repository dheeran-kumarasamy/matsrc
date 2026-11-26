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
import { WHATSAPP_SEND_PROVIDER, WhatsAppSendAdapter } from "./adapters/whatsapp-send.interface";
import { MockWhatsAppSendAdapter } from "./adapters/mock-whatsapp-send.adapter";
import { MetaCloudApiSendAdapter } from "./adapters/meta-cloud-api-send.adapter";

import { PriceUpdateFlow } from "./flows/price-update.flow";
import { EnquiryDecisionFlow } from "./flows/enquiry-decision.flow";
import { OrderStatusFlow } from "./flows/order-status.flow";
import { DailyReportFlow } from "./flows/daily-report.flow";
import { SupplierDailyPriceReplyFlow } from "./flows/supplier-daily-price-reply.flow";
import { InboundTemplateReplyFlow } from "./flows/inbound-template-reply.flow";
import { NotificationEngineModule } from "../notification-engine/notification-engine.module";

/**
 * Factory for WHATSAPP_SEND_PROVIDER.
 *
 * Fail-closed preview protection:
 * When VERCEL_ENV === "preview", always select MockWhatsAppSendAdapter regardless
 * of WHATSAPP_ADAPTER to guarantee preview deployments never dispatch live Meta messages.
 *
 * In production/non-preview:
 *  - Explicit WHATSAPP_ADAPTER="meta" selects MetaCloudApiSendAdapter.
 *  - Explicit WHATSAPP_ADAPTER="mock" selects MockWhatsAppSendAdapter.
 *  - If WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are configured, default to MetaCloudApiSendAdapter
 *    to prevent silent fallback to mock in production environments where WHATSAPP_ADAPTER wasn't explicitly set.
 */
export function whatsAppSendProviderFactory(
  mock: MockWhatsAppSendAdapter,
  meta: MetaCloudApiSendAdapter
): WhatsAppSendAdapter {
  if (process.env.VERCEL_ENV === "preview") {
    return mock;
  }
  if (process.env.WHATSAPP_ADAPTER === "meta") {
    return meta;
  }
  if (process.env.WHATSAPP_ADAPTER === "mock") {
    return mock;
  }
  if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return meta;
  }
  return mock;
}

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
    InboundTemplateReplyFlow,
    MockWhatsAppSendAdapter,
    MetaCloudApiSendAdapter,
    {
      provide: WHATSAPP_SEND_PROVIDER,
      useFactory: whatsAppSendProviderFactory,
      inject: [MockWhatsAppSendAdapter, MetaCloudApiSendAdapter],
    },
  ],
})
export class WhatsAppModule {}
