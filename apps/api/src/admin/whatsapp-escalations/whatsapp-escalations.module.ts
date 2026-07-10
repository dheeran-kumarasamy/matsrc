import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { WhatsAppEscalationsController } from "./whatsapp-escalations.controller";
import { WhatsAppEscalationsService } from "./whatsapp-escalations.service";

@Module({
  imports: [AdminModule],
  controllers: [WhatsAppEscalationsController],
  providers: [WhatsAppEscalationsService],
})
export class WhatsAppEscalationsModule {}
