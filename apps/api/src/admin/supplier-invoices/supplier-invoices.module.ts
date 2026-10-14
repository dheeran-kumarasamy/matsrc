import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { SupplierInvoicesController } from "./supplier-invoices.controller";
import { SupplierInvoicesService } from "./supplier-invoices.service";

@Module({
  imports: [AdminModule],
  controllers: [SupplierInvoicesController],
  providers: [SupplierInvoicesService],
  exports: [SupplierInvoicesService],
})
export class SupplierInvoicesModule {}
