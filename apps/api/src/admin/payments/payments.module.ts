import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [AdminModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
