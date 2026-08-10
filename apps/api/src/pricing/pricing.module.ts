import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PricingConfigService } from "./pricing-config.service";
import { APIFY_ACTOR_CLIENT, LiveApifyActorClient, StubApifyActorClient } from "./apify-actor-client";
import { NATIVE_EXTRACTOR_CLIENT, NativeHttpExtractorClient } from "./native-http-extractor-client";
import { PricingIngestionService } from "./pricing-ingestion.service";
import { PricingNormalizationService } from "./pricing-normalization.service";
import { PricingAnomalyDetectionService } from "./pricing-anomaly-detection.service";
import { PricingDailyRollupService } from "./pricing-daily-rollup.service";
import { PricingMonthlyRollupService } from "./pricing-monthly-rollup.service";
import { PricingSchedulerService } from "./pricing-scheduler.service";
import { PublicPricingController } from "./public-pricing.controller";
import { NotificationsModule } from "src/notifications/notifications.module";
import { WatchlistBridgeService } from "./alerting/watchlist-bridge.service";
import { PricingAlertEvaluationService } from "./alerting/pricing-alert-evaluation.service";

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
 *
 * Phase 6D adds the Watchlist Price Alert engine (WatchlistBridgeService +
 * PricingAlertEvaluationService). NotificationsModule is imported so the
 * alert engine can reuse the existing NotificationService rather than
 * building new notification infrastructure. The alert engine is invoked
 * directly by PricingSchedulerService immediately after a successful daily
 * rollup — it is never scheduled independently.
 */
@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule],
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
    // Phase 6E-3 Batch D-3: native (non-Apify) extraction client, used only
    // for the small set of sources proven to need it (see
    // native-http-extractor-client.ts). Always bound directly (no stub
    // switch) since it makes no Apify calls and has no cost/credentials
    // implication either way.
    {
      provide: NATIVE_EXTRACTOR_CLIENT,
      useClass: NativeHttpExtractorClient,
    },
    PricingIngestionService,
    PricingNormalizationService,
    PricingAnomalyDetectionService,
    PricingDailyRollupService,
    PricingMonthlyRollupService,
    PricingSchedulerService,
    // Phase 6D: Watchlist Price Alert engine.
    WatchlistBridgeService,
    PricingAlertEvaluationService,
  ],
  exports: [
    PricingConfigService,
    PricingIngestionService,
    PricingNormalizationService,
    PricingAnomalyDetectionService,
    PricingDailyRollupService,
    PricingMonthlyRollupService,
    PricingAlertEvaluationService,
  ],
})
export class PricingModule {}
