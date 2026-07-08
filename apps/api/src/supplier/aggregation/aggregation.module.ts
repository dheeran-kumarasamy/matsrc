import { Module } from "@nestjs/common";
import { SupplierModule } from "src/supplier/supplier.module";
import { AggregationModule } from "src/aggregation/aggregation.module";
import { SupplierAggregationController } from "./aggregation.controller";

@Module({
  imports: [SupplierModule, AggregationModule],
  controllers: [SupplierAggregationController],
})
export class SupplierAggregationModule {}
