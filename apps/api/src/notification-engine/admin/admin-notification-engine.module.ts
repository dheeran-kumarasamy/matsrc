import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { NotificationEngineModule } from "../notification-engine.module";
import { AdminNotificationsController } from "./admin-notifications.controller";
import { AdminNotificationsService } from "./admin-notifications.service";
import { AdminWhatsAppTestController } from "./admin-whatsapp-test.controller";
import { AdminWhatsAppTestService } from "./admin-whatsapp-test.service";

@Module({
  imports: [AdminModule, NotificationEngineModule],
  controllers: [AdminNotificationsController, AdminWhatsAppTestController],
  providers: [AdminNotificationsService, AdminWhatsAppTestService],
})
export class AdminNotificationEngineModule {}
