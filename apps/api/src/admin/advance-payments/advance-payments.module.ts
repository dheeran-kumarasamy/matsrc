import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { AdvancePaymentsController } from "./advance-payments.controller";
import { AdvancePaymentsService } from "./advance-payments.service";

@Module({
  imports: [AdminModule, NotificationsModule],
  controllers: [AdvancePaymentsController],
  providers: [AdvancePaymentsService],
})
export class AdvancePaymentsModule {}
