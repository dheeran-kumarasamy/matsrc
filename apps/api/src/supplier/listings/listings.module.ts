import { Module } from "@nestjs/common";
import { SupplierModule } from "src/supplier/supplier.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { NotificationEngineModule } from "src/notification-engine/notification-engine.module";
import { ListingsController } from "./listings.controller";
import { ListingsService } from "./listings.service";

@Module({
  imports: [SupplierModule, NotificationsModule, NotificationEngineModule],
  controllers: [ListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
