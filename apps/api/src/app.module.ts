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
import { AdminModule } from "./admin/admin.module";
import { AdminDashboardModule } from "./admin/dashboard/dashboard.module";
import { VendorsModule } from "./admin/vendors/vendors.module";
import { KycModule } from "./admin/kyc/kyc.module";
import { DisputesModule } from "./admin/disputes/disputes.module";
import { AuditModule } from "./admin/audit/audit.module";

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
    AdminModule,
    AdminDashboardModule,
    VendorsModule,
    KycModule,
    DisputesModule,
    AuditModule,
  ],
  providers: [RoleGuard],
})
export class AppModule {}