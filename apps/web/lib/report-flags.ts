// Simple env-based feature flag for the Live Market Prices report's supplier
// display-name visibility. Live Market Prices should, by default, surface
// only the lowest/highest supplier rates for a material without naming the
// suppliers themselves (keeps competitive pricing anonymous). Set
// LIVE_MARKET_PRICES_SHOW_SUPPLIER_NAMES="true" to switch the report back to
// showing every supplier's name alongside their price, without a code
// redeploy — same env-flag convention as
// apps/api/src/aggregation/aggregation-config.service.ts's
// AggregationConfigService.isEnabled().
export function shouldShowSupplierNames(): boolean {
  const raw = process.env.LIVE_MARKET_PRICES_SHOW_SUPPLIER_NAMES;
  if (raw === undefined) {
    return false;
  }
  return raw.trim().toLowerCase() === "true" || raw.trim() === "1";
}
