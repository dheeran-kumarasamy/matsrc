import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { AdminInvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";

@Module({
  imports: [AdminModule],
  controllers: [AdminInvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
