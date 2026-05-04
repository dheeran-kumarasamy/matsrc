import { Module } from "@nestjs/common";
import { SupplierModule } from "src/supplier/supplier.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [SupplierModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}