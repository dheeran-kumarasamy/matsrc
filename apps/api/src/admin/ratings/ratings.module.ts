import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { AdminRatingsController } from "./ratings.controller";
import { AdminRatingsService } from "./ratings.service";

@Module({
  imports: [AdminModule],
  controllers: [AdminRatingsController],
  providers: [AdminRatingsService],
})
export class AdminRatingsModule {}
