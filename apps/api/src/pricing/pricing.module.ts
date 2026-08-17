import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PricingConfigService } from "./pricing-config.service";
import { APIFY_ACTOR_CLIENT, ApifyActorClient, LiveApifyActorClient, StubApifyActorClient } from "./apify-actor-client";
import { NATIVE_EXTRACTOR_CLIENT, NativeHttpExtractorClient } from "./native-http-extractor-client";
import { PricingIngestionService } from "./pricing-ingestion.service";
import { PricingNormalizationService } from "./pricing-normalization.service";
import { PricingAnomalyDetectionService } from "./pricing-anomaly-detection.service";
import { PricingDailyRollupService } from "./pricing-daily-rollup.service";
import { PricingMonthlyRollupService } from "./pricing-monthly-rollup.service";
import { PricingResolutionService } from "./pricing-resolution.service";
import { PricingSchedulerService } from "./pricing-scheduler.service";
import { PublicPricingController } from "./public-pricing.controller";
import { NotificationsModule } from "src/notifications/notifications.module";
import { WatchlistBridgeService } from "./alerting/watchlist-bridge.service";
import { PricingAlertEvaluationService } from "./alerting/pricing-alert-evaluation.service";
import { PricingCronController } from "./pricing-cron.controller";
import { CronSecretGuard } from "./cron-secret.guard";

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
 *
 * IMPORTANT — scheduling on Vercel: apps/api is deployed as a Vercel
 * serverless function (see apps/api/api/index.ts), so PricingSchedulerService's
 * @Cron methods never actually fire in production (no long-lived process
 * for @nestjs/schedule's in-memory timers). PricingCronController exposes
 * the same job methods behind a CronSecretGuard-protected HTTP route so a
 * real Vercel Cron Job (apps/api/vercel.json's `crons` array) can trigger
 * them on schedule instead. See pricing-cron.controller.ts for exactly
 * what is (and, deliberately, is not) covered.
 *
 * IMPORTANT — LiveApifyActorClient must never be an eagerly-instantiated
 * standalone provider. Nest builds every non-request-scoped provider listed
 * in `providers` at module-bootstrap time, regardless of whether anything
 * ends up injecting it — so if `LiveApifyActorClient` were listed directly
 * (as it once was), its constructor (which throws when APIFY_TOKEN is
 * absent) would run, and crash app startup, even when
 * PRICING_APIFY_LIVE_ENABLED=false. apifyActorClientFactory() below is the
 * only place LiveApifyActorClient is ever constructed (via `new`, not via
 * DI), and only when isApifyLiveEnabled() is true — so with the flag off
 * (the default/current production setting), no LiveApifyActorClient
 * instance is ever created and no APIFY_TOKEN is required to boot.
 */

/**
 * Resolves the ApifyActorClient bound to APIFY_ACTOR_CLIENT. Exported (and
 * kept as a plain, named function rather than an inline arrow in the
 * @Module decorator) so it can be unit-tested directly without booting a
 * full Nest TestingModule — see pricing.module.spec.ts.
 *
 * LiveApifyActorClient is deliberately constructed here with `new`, lazily,
 * only inside the `isApifyLiveEnabled()` branch — never listed as its own
 * provider in the module (see the module-level comment above for why).
 */
export function apifyActorClientFactory(
  config: PricingConfigService,
  stub: StubApifyActorClient
): ApifyActorClient {
  return config.isApifyLiveEnabled() ? new LiveApifyActorClient() : stub;
}

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule],
  controllers: [PublicPricingController, PricingCronController],
  providers: [
    CronSecretGuard,
    PricingConfigService,
    StubApifyActorClient,
    {
      provide: APIFY_ACTOR_CLIENT,
      useFactory: apifyActorClientFactory,
      inject: [PricingConfigService, StubApifyActorClient],
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
    // Phase 6F: Geographic Pricing Hierarchy resolution service.
    PricingResolutionService,
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
    PricingResolutionService,
    PricingAlertEvaluationService,
  ],
})
export class PricingModule {}
