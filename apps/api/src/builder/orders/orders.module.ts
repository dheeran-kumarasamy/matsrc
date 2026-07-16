import { Module } from "@nestjs/common";
import { BuilderModule } from "src/builder/builder.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { WhatsAppLifecycleModule } from "src/whatsapp/lifecycle/whatsapp-lifecycle.module";
import { BuilderOrdersController } from "./orders.controller";
import { BuilderOrdersService } from "./orders.service";

@Module({
  imports: [BuilderModule, NotificationsModule, WhatsAppLifecycleModule],
  controllers: [BuilderOrdersController],
  providers: [BuilderOrdersService],
})
export class BuilderOrdersModule {}
