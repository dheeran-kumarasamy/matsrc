import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { PricingModule } from "src/pricing/pricing.module";
import { AdminPricingController } from "./admin-pricing.controller";

@Module({
  imports: [AdminModule, PricingModule],
  controllers: [AdminPricingController],
})
export class AdminPricingModule {}
