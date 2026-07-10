import { Module } from "@nestjs/common";
import { SupplierModule } from "src/supplier/supplier.module";
import { ListingsController } from "./listings.controller";
import { ListingsService } from "./listings.service";

@Module({
  imports: [SupplierModule],
  controllers: [ListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}

