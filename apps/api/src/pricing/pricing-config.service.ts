import { Injectable } from "@nestjs/common";

/**
 * Simple env-based feature flag for the Price Intelligence module, following
 * the exact pattern of AggregationConfigService. Set
 * PRICING_FEATURE_ENABLED=false to disable actor triggering / ingestion
 * platform-wide without a redeploy rollback.
 *
 * Separately, PRICING_APIFY_LIVE_ENABLED gates whether the real Apify SDK
 * should be used (see apify-actor-client.service.ts) — it defaults to false
 * because no Apify credentials/SDK are configured in this repo yet. Turning
 * this on without also installing an Apify SDK dependency and setting
 * APIFY_TOKEN will have no effect; the stub client will keep being used.
 */
@Injectable()
export class PricingConfigService {
  isEnabled(): boolean {
    const raw = process.env.PRICING_FEATURE_ENABLED;
    if (raw === undefined) {
      return true;
    }
    return raw.trim().toLowerCase() !== "false" && raw.trim() !== "0";
  }

  isApifyLiveEnabled(): boolean {
    const raw = process.env.PRICING_APIFY_LIVE_ENABLED;
    if (raw === undefined) {
      return false;
    }
    return raw.trim().toLowerCase() === "true" || raw.trim() === "1";
  }
}
