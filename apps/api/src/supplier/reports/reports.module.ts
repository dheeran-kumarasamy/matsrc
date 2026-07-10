import { Module } from "@nestjs/common";
import { SupplierModule } from "src/supplier/supplier.module";
import { ReportsController } from "./reports.controller";
import { SupplierReportsService } from "./reports.service";

@Module({
  imports: [SupplierModule],
  controllers: [ReportsController],
  providers: [SupplierReportsService],
  exports: [SupplierReportsService],
})
export class SupplierReportsModule {}
