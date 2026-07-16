import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { SupplierRejectionsController } from "./supplier-rejections.controller";
import { SupplierRejectionsService } from "./supplier-rejections.service";

@Module({
  imports: [AdminModule],
  controllers: [SupplierRejectionsController],
  providers: [SupplierRejectionsService],
})
export class SupplierRejectionsModule {}
