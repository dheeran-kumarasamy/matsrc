import { Module } from "@nestjs/common";
import { BuilderModule } from "src/builder/builder.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { WhatsAppLifecycleModule } from "src/whatsapp/lifecycle/whatsapp-lifecycle.module";
import { PurchaseOrdersController } from "./purchase-orders.controller";
import { PurchaseOrdersService } from "./purchase-orders.service";

@Module({
  imports: [BuilderModule, NotificationsModule, WhatsAppLifecycleModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
