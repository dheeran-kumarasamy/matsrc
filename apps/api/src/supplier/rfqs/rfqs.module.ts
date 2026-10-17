import { Module } from "@nestjs/common";
import { NotificationsModule } from "src/notifications/notifications.module";
import { SupplierModule } from "src/supplier/supplier.module";
import { NotificationEngineModule } from "src/notification-engine/notification-engine.module";
import { MarkupModule } from "src/admin/markup/markup.module";
import { BestPriceSelectionService } from "./best-price-selection.service";
import { RfqsController } from "./rfqs.controller";
import { RfqsService } from "./rfqs.service";

@Module({
  imports: [SupplierModule, NotificationsModule, NotificationEngineModule, MarkupModule],
  controllers: [RfqsController],
  providers: [RfqsService, BestPriceSelectionService],
  exports: [RfqsService],
})
export class RfqsModule {}

