import { Module } from "@nestjs/common";
import { NotificationsModule } from "src/notifications/notifications.module";
import { AggregationConfigService } from "./aggregation-config.service";
import { AggregationService } from "./aggregation.service";
import { AggregationSchedulerService } from "./aggregation-scheduler.service";

/**
 * Shared aggregation module — pool matching engine, feature flag, and the
 * window-close/max-tier sweep scheduler. Builder/Supplier/Admin API modules
 * (Phase 2) import this module to expose controllers on top of these services.
 */
@Module({
  imports: [NotificationsModule],
  providers: [AggregationConfigService, AggregationService, AggregationSchedulerService],
  exports: [AggregationConfigService, AggregationService, AggregationSchedulerService],
})
export class AggregationModule {}
