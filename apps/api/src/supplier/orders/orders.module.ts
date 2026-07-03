import { Module } from "@nestjs/common";
import { SupplierModule } from "src/supplier/supplier.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [SupplierModule, NotificationsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}