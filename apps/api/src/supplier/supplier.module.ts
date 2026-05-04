import { Module } from "@nestjs/common";
import { SupplierContextService } from "./supplier-context.service";

@Module({
  providers: [SupplierContextService],
  exports: [SupplierContextService],
})
export class SupplierModule {}