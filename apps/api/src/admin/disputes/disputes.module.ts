import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { DisputesController } from "./disputes.controller";
import { DisputesService } from "./disputes.service";

@Module({
  imports: [AdminModule],
  controllers: [DisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}
