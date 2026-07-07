import { Injectable } from "@nestjs/common";

/**
 * Simple env-based feature flag for the Order Aggregation ("Group & Save") feature.
 * Set AGGREGATION_FEATURE_ENABLED=false to disable platform-wide without a redeploy
 * rollback (services will reject opt-in / pool-creation calls while still allowing
 * existing pools to be read/observed).
 */
@Injectable()
export class AggregationConfigService {
  isEnabled(): boolean {
    const raw = process.env.AGGREGATION_FEATURE_ENABLED;
    if (raw === undefined) {
      return true;
    }
    return raw.trim().toLowerCase() !== "false" && raw.trim() !== "0";
  }
}
