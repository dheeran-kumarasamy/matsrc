import { Module } from "@nestjs/common";
import { SupplierModule } from "src/supplier/supplier.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { WhatsAppLifecycleModule } from "src/whatsapp/lifecycle/whatsapp-lifecycle.module";
import { NotificationEngineModule } from "src/notification-engine/notification-engine.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [SupplierModule, NotificationsModule, WhatsAppLifecycleModule, NotificationEngineModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
