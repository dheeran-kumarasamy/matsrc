import { Module } from "@nestjs/common";
import { BuilderModule } from "src/builder/builder.module";
import { AggregationModule } from "src/aggregation/aggregation.module";
import { BuilderAggregationController } from "./aggregation.controller";

@Module({
  imports: [BuilderModule, AggregationModule],
  controllers: [BuilderAggregationController],
})
export class BuilderAggregationModule {}
