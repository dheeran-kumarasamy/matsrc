import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { AdminDashboardController } from "./dashboard.controller";
import { AdminDashboardService } from "./dashboard.service";

@Module({
  imports: [AdminModule],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
