import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { NotificationEngineModule } from "src/notification-engine/notification-engine.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [AdminModule, NotificationsModule, NotificationEngineModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
