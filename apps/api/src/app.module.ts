import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { RoleGuard } from "./auth/role.guard";
import { ListingsModule } from "./supplier/listings/listings.module";
import { OrdersModule } from "./supplier/orders/orders.module";
import { RfqsModule } from "./supplier/rfqs/rfqs.module";
import { SupplierModule } from "./supplier/supplier.module";
import { BuilderModule } from "./builder/builder.module";
import { CartModule } from "./builder/cart/cart.module";
import { BuilderOrdersModule } from "./builder/orders/orders.module";
import { WatchlistModule } from "./builder/watchlist/watchlist.module";
import { BuilderRfqsModule } from "./builder/rfqs/rfqs.module";
import { CreditModule } from "./builder/credit/credit.module";
import { BuilderDisputesModule } from "./builder/disputes/disputes.module";
import { PurchaseOrdersModule } from "./builder/purchase-orders/purchase-orders.module";
import { AdminModule } from "./admin/admin.module";
import { AdminDashboardModule } from "./admin/dashboard/dashboard.module";
import { VendorsModule } from "./admin/vendors/vendors.module";
import { KycModule } from "./admin/kyc/kyc.module";
import { DisputesModule } from "./admin/disputes/disputes.module";
import { AuditModule } from "./admin/audit/audit.module";
import { WhatsAppEscalationsModule } from "./admin/whatsapp-escalations/whatsapp-escalations.module";

import { NotificationsModule } from "./notifications/notifications.module";
import { PublicInsightsModule } from "./public-insights/public-insights.module";
import { AggregationModule } from "./aggregation/aggregation.module";
import { BuilderAggregationModule } from "./builder/aggregation/aggregation.module";
import { SupplierAggregationModule } from "./supplier/aggregation/aggregation.module";
import { AdminAggregationModule } from "./admin/aggregation/aggregation.module";
import { SupplierReportsModule } from "./supplier/reports/reports.module";
import { WhatsAppModule } from "./whatsapp/whatsapp.module";


@Module({

  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    SupplierModule,
    ListingsModule,
    OrdersModule,
    RfqsModule,
    BuilderModule,
    CartModule,
    BuilderOrdersModule,
    WatchlistModule,
    BuilderRfqsModule,
    CreditModule,
    BuilderDisputesModule,
    PurchaseOrdersModule,
    NotificationsModule,
    PublicInsightsModule,
    AggregationModule,
    BuilderAggregationModule,
    SupplierAggregationModule,
    AdminAggregationModule,
    AdminModule,

    AdminDashboardModule,
    VendorsModule,
    KycModule,
    DisputesModule,
    AuditModule,
    WhatsAppEscalationsModule,
    SupplierReportsModule,

    WhatsAppModule,
  ],

  providers: [RoleGuard],
})
export class AppModule {}
