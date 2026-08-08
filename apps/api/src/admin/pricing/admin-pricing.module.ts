import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { PricingModule } from "src/pricing/pricing.module";
import { AdminPricingController } from "./admin-pricing.controller";
import { PricingAdminOpsService } from "./pricing-admin-ops.service";

@Module({
  imports: [AdminModule, PricingModule],
  controllers: [AdminPricingController],
  providers: [PricingAdminOpsService],
})
export class AdminPricingModule {}

