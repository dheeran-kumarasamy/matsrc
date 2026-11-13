import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { MarkupController } from "./markup.controller";
import { MarkupService } from "./markup.service";

@Module({
  imports: [AdminModule],
  controllers: [MarkupController],
  providers: [MarkupService],
  exports: [MarkupService],
})
export class MarkupModule {}
