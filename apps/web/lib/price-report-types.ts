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
};
