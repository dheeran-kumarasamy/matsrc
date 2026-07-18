import type { ReportDefinition } from "@/lib/reports-types";

// The 7 Builder Reports catalogue. `available` reflects whether real backing
// data exists today (verified against the Prisma schema + codebase):
// - Material Consumption Report: Order/OrderItem history — real, queryable.
// - Best Supplier Pricing: CanonicalProduct cross-supplier grouping — real.
// - Potential Cost Savings: derived from the two reports above — real.
// - Live Market Prices / Regional Price Comparison / AI Recommendation:
//   no live cross-supplier aggregation service or region metadata exists.
// - Historical Price Trends: the `PricePoint` model exists in schema but is
//   never written to anywhere in the codebase (dead/empty table) — treated
//   as unavailable rather than shipping a report that always renders empty.
export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: "material-consumption",
    title: "Material Consumption Report",
    description: "How much of each material you've ordered and used, by project.",
    dataSource: "Account data",
    available: true,
  },
  {
    id: "live-market-prices",
    title: "Live Market Prices",
    description: "Current prices for materials across active suppliers, updated in real time.",
    dataSource: "Live feed",
    available: false,
  },
  {
    id: "regional-price-comparison",
    title: "Regional Price Comparison",
    description: "Compare prices for the same material across different regions and cities.",
    dataSource: "Live feed",
    available: false,
  },
  {
    id: "historical-price-trends",
    title: "Historical Price Trends",
    description: "How material prices have moved over the past weeks and months.",
    dataSource: "Historical data",
    available: false,
  },
  {
    id: "best-supplier-pricing",
    title: "Best Supplier Pricing",
    description: "Which suppliers currently offer the best price on materials you buy often.",
    dataSource: "Account data",
    available: true,
  },
  {
    id: "ai-buy-recommendation",
    title: "AI Recommendation: When to Buy",
    description: "A suggested buying window based on price trends and demand signals.",
    dataSource: "AI insight",
    available: false,
  },
  {
    id: "potential-cost-savings",
    title: "Potential Cost Savings",
    description: "Estimate how much you could save by switching suppliers or timing purchases differently.",
    dataSource: "Account data",
    available: true,
  },
];
