import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { AggregationModule } from "src/aggregation/aggregation.module";
import { AdminAggregationController } from "./aggregation.controller";

@Module({
  imports: [AdminModule, AggregationModule],
  controllers: [AdminAggregationController],
})
export class AdminAggregationModule {}
