import { Module } from "@nestjs/common";
import { NotificationsModule } from "src/notifications/notifications.module";
import { SupplierModule } from "src/supplier/supplier.module";
import { BestPriceSelectionService } from "./best-price-selection.service";
import { RfqsController } from "./rfqs.controller";
import { RfqsService } from "./rfqs.service";

@Module({
  imports: [SupplierModule, NotificationsModule],
  controllers: [RfqsController],
  providers: [RfqsService, BestPriceSelectionService],
})
export class RfqsModule {}