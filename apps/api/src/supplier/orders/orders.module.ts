import { Module } from "@nestjs/common";
import { SupplierModule } from "src/supplier/supplier.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { NotificationEngineModule } from "src/notification-engine/notification-engine.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

// WhatsAppLifecycleModule was removed from here — OrdersService no longer
// injects WhatsAppLifecycleService (its customer_order_status-duplicating
// notifyBuilderOrderStatusTransition call was removed; see
// OrdersService.updateStatus's doc comment). WhatsAppAlertsModule (Twilio)
// is still transitively available via NotificationsModule for completeness,
// but is likewise unused by OrdersService now — kept only because
// NotificationsModule itself is still required for NotificationService.
@Module({
  imports: [SupplierModule, NotificationsModule, NotificationEngineModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
