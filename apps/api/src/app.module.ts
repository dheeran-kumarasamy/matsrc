import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { ListingsModule } from "./supplier/listings/listings.module";
import { OrdersModule } from "./supplier/orders/orders.module";
import { RfqsModule } from "./supplier/rfqs/rfqs.module";
import { SupplierModule } from "./supplier/supplier.module";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, SupplierModule, ListingsModule, OrdersModule, RfqsModule],
})
export class AppModule {}