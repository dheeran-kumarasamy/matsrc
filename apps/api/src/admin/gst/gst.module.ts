import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { GstController } from "./gst.controller";
import { GstService } from "./gst.service";
import { AdvanceConfigService } from "./advance-config.service";

@Module({
  imports: [AdminModule],
  controllers: [GstController],
  providers: [GstService, AdvanceConfigService],
  exports: [GstService, AdvanceConfigService],
})
export class GstModule {}
