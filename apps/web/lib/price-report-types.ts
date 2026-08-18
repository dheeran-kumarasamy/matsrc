// Shared response shape for GET /api/builder/products/[canonicalProductId]/report
// Kept in one place so the report page + its module components don't drift
// out of sync with the route's actual JSON shape.

export type SignalVerdict = "BUY" | "HOLD" | "WAIT";
export type SignalConfidence = "low" | "medium" | "high";

export type ReportSignal = {
  verdict: SignalVerdict;
  confidence: SignalConfidence;
  reasons: string[];
};

// P1 (Matsrc Intelligence Integration): discloses which real data series the
// signal/forecast were actually computed from, so the UI never presents the
// numbers as if their provenance were interchangeable.
export type ReportDataSource = "district_intelligence" | "order_history" | "insufficient_data";

export type ForecastPoint = {
  date: string;
  price: number;
  lower: number;
  upper: number;
};

export type ReportForecast = {
  points: ForecastPoint[];
  trendSlopePercent: number;
  method: string;
  hasEnoughData: boolean;
};

export type ReportHistoryEntry = {
  id: string;
  price: number;
  source: string;
  unit: string | null;
  region: string | null;
  recordedAt: string;
  supplierId: string;
};

export type LandedCostBreakdown = {
  basePrice: number;
  quantity: number;
  subtotal: number;
  estimatedDelivery: number;
  gstRatePercent: number;
  gstAmount: number;
  landedCost: number;
  landedUnitCost: number;
  // P1: which inputs were unavailable (e.g. ["freight"]) — additive/optional
  // so existing consumers of this type are unaffected.
  dataGaps?: string[];
};

export type BestPriceOffer = {
  productId: string;
  supplierId: string;
  supplierName: string;
  brand: string | null;
  unit: string | null;
  basePrice: number;
  stock: number | null;
  maxServiceableQty: number | null;
  landedCost: LandedCostBreakdown;
};

export type RegionalAverage = {
  region: string;
  averagePrice: number;
  sampleSize: number;
};

export type ReportRegional = {
  builderRegion: string | null;
  hasEnoughData: boolean;
  regions: RegionalAverage[];
};

export type MarketDriver = { title: string; detail: string };
export type MarketSource = { name: string; url: string };

export type MarketInsight = {
  category: string;
  region: string;
  drivers: MarketDriver[];
  outlook: string;
  sources: MarketSource[];
  generatedAt: string;
  expiresAt: string;
  stale: boolean;
};

// P2-A (Market Benchmark) — mirrors lib/market-benchmark.ts's
// MarketBenchmarkResult shape (kept as its own type here rather than
// importing across the client/server boundary casually, matching this
// file's existing "shared response shape" convention).
export type MarketBenchmark =
  | {
      available: true;
      referencePrice: number;
      referenceUnit: string;
      referenceLevel: "DISTRICT" | "STATE" | "NATIONAL";
      locationLabel: string;
      asOf: string;
      isStale: boolean;
      fallbackUsed: boolean;
      comparisonPrice: number;
      differenceAbsolute: number;
      differencePercent: number;
      comparisonStatus: "BELOW_MARKET" | "AT_MARKET" | "ABOVE_MARKET";
    }
  | {
      available: false;
      unavailableReason: "NO_REFERENCE_DATA" | "UNIT_INCOMPATIBLE";
    };

export type PriceReportResponse = {
  canonicalProductId: string;
  title: string;
  category: string;
  signal: ReportSignal;
  forecast: ReportForecast;
  history: ReportHistoryEntry[];
  bestPrice: BestPriceOffer[];
  regional: ReportRegional;
  marketInsight: MarketInsight | null;
  // P1 (Matsrc Intelligence Integration) — additive/optional fields.
  // dataSource discloses whether signal/forecast came from the canonical
  // district/state price-intelligence series or the platform's own
  // order-history snapshots (or neither, when there's insufficient data).
  dataSource?: ReportDataSource;
  intelligenceDataGaps?: string[];
  // P2-A (Market Benchmark) — additive/optional.
  marketBenchmark?: MarketBenchmark;
};
