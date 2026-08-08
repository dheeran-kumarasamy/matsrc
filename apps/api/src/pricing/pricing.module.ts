import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PricingConfigService } from "./pricing-config.service";
import { APIFY_ACTOR_CLIENT, LiveApifyActorClient, StubApifyActorClient } from "./apify-actor-client";
import { PricingIngestionService } from "./pricing-ingestion.service";
import { PricingNormalizationService } from "./pricing-normalization.service";
import { PricingAnomalyDetectionService } from "./pricing-anomaly-detection.service";
import { PricingDailyRollupService } from "./pricing-daily-rollup.service";
import { PricingMonthlyRollupService } from "./pricing-monthly-rollup.service";
import { PricingSchedulerService } from "./pricing-scheduler.service";
import { PublicPricingController } from "./public-pricing.controller";

/**
 * Price Intelligence ingestion module (Phase 2 of the district-wise price
 * intelligence spec). Wires together:
 *   - PricingConfigService: feature flags (PRICING_FEATURE_ENABLED,
 *     PRICING_APIFY_LIVE_ENABLED)
 *   - StubApifyActorClient bound to APIFY_ACTOR_CLIENT: the pluggable actor
 *     client boundary (see apify-actor-client.ts for why this is a stub and
 *     how to swap in a live implementation later)
 *   - PricingIngestionService: PricingSourceEndpoint -> PricingScrapeRun +
 *     PricingRawObservation landing
 *   - PricingNormalizationService: PricingRawObservation -> PricingObservation
 *     normalization via PricingSkuAlias + PricingUnitConversion
 *
 * No controller yet — Phase 2's confirmed scope is the ingestion/
 * normalization pipeline itself, not the admin/API surface on top of it.
 * Follows the same shape as AggregationModule (services only, exported for
 * a future controller module to consume).
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [PublicPricingController],
  providers: [
    PricingConfigService,
    StubApifyActorClient,
    LiveApifyActorClient,
    {
      provide: APIFY_ACTOR_CLIENT,
      useFactory: (config: PricingConfigService, stub: StubApifyActorClient, live: LiveApifyActorClient) =>
        config.isApifyLiveEnabled() ? live : stub,
      inject: [PricingConfigService, StubApifyActorClient, LiveApifyActorClient],
    },
    PricingIngestionService,
    PricingNormalizationService,
    PricingAnomalyDetectionService,
    PricingDailyRollupService,
    PricingMonthlyRollupService,
    PricingSchedulerService,
  ],
  exports: [
    PricingConfigService,
    PricingIngestionService,
    PricingNormalizationService,
    PricingAnomalyDetectionService,
    PricingDailyRollupService,
    PricingMonthlyRollupService,
  ],
})
export class PricingModule {}
