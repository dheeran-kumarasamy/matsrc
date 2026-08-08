// Shared types for the Phase 6C Batch A admin Price Intelligence surface.
// Mirrors the shapes returned by PricingAdminOpsService (apps/api/src/admin/pricing/pricing-admin-ops.service.ts).

export type PricingDashboardSummary = {
  platformHealth: {
    sourcesEnabled: number;
    sourcesDisabled: number;
    healthySources: number;
    failedSources: number;
    activeSchedulers: number;
    lastSuccessfulIngestion: string | null;
    lastFailedIngestion: string | null;
    lastSuccessfulRollup: string | null;
    lastSuccessfulNormalization: string | null;
    lastMonthlyRollup: boolean;
    lastRefreshTime: string;
  };
  processingSummary: {
    raw: number;
    parsed: number;
    normalized: number;
    rejected: number;
    unmapped: number;
    quarantined: number;
    published: number;
    derived: number;
  };
  observationTrend: {
    last24h: number;
    last7d: number;
    last30d: number;
  };
  pipelineStatus: { stage: string; status: "HEALTHY" | "WARNING" | "FAILED" | string }[];
};

export type PricingAdminSource = {
  id: string;
  code: string;
  name: string;
  tier: string;
  licenseClass: string;
  isEnabled: boolean;
  robotsAllowed: boolean;
  tosReviewedAt: string | null;
  publicDisplayAllowed: boolean;
  cronExpression: string | null;
  endpointCount: number;
  enabledEndpointCount: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  averageDurationMs: number | null;
  successRate: number | null;
  failureRate: number | null;
  lastError: string | null;
  costThisMonth: number;
  projectedCost: number;
  rowsCollected: number;
  rowsParsed: number;
  rowsPublished: number;
  configComplete: boolean;
};

export type PricingAdminEndpoint = {
  id: string;
  url: string;
  district: { code: string; name: string } | null;
  category: { code: string; name: string } | null;
  source: { id: string; code: string; name: string };
  isEnabled: boolean;
  lastStatus: string | null;
  lastFetchedAt: string | null;
  consecutiveFailures: number;
  disabledReason: string | null;
  autoDisabled: boolean;
};

export type PricingSchedulerJob = {
  name: string;
  running: boolean;
  nextExecution: string | null;
};

export type PricingSchedulerRun = {
  id: string;
  sourceCode: string;
  sourceName: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  triggeredBy: string | null;
  errorMessage: string | null;
  itemsFetched: number;
};

export type PricingSchedulerStatus = {
  jobs: PricingSchedulerJob[];
  recentRuns: PricingSchedulerRun[];
};

export type PricingRollupStatus = {
  lastDailyRollupDate: string | null;
  lastMonthlyRollupMonth: string | null;
  totalDailyRows: number;
  totalMonthlyRows: number;
};

// ───────────────────────── Batch B: Visibility & Compliance Layer ─────────────────────────

export type PricingCoverageCell = {
  districtId: string;
  districtCode: string;
  categoryId: string;
  categoryCode: string;
  state: "OBSERVED" | "DERIVED" | "MISSING" | "NO_DATA";
  observationCount: number;
  confidence: string | null;
  lastUpdated: string | null;
  trend: "UP" | "DOWN" | "FLAT" | null;
};

export type PricingCoverageMatrix = {
  districts: { id: string; code: string; name: string }[];
  categories: { id: string; code: string; name: string }[];
  cells: PricingCoverageCell[];
};

export type PricingDataQualitySummary = {
  coveragePct: number;
  districtCoveragePct: number;
  categoryCoveragePct: number;
  skuCoveragePct: number;
  duplicateRatePct: number;
  ambiguousUnitConversions: number;
  rejectedRows: number;
  unmappedPct: number;
  derivedPct: number;
  averageConfidenceScore: number;
  staleSourceCount: number;
  dataAgeHours: number | null;
  topMissingDistricts: { code: string; count: number }[];
  topMissingCategories: { code: string; count: number }[];
  topMissingSkus: { id: string; code: string }[];
};

export type PricingComplianceSource = {
  id: string;
  code: string;
  name: string;
  licenseClass: string;
  publicExposure: boolean;
  attribution: string | null;
  tosReviewedAt: string | null;
  reviewAgeDays: number | null;
  expiredReview: boolean;
  missingReview: boolean;
  robotsAllowed: boolean;
  isEnabled: boolean;
  complianceRisk: boolean;
};

export type PricingComplianceSummary = {
  byLicenseClass: Record<string, number>;
  sources: PricingComplianceSource[];
  expiredReviewCount: number;
  missingReviewCount: number;
  disabledSourceCount: number;
  complianceRiskCount: number;
  internalOnlyExposureViolations: number;
};

export type PricingCostPerSource = {
  sourceId: string;
  sourceCode: string;
  sourceName: string;
  costLast30d: number;
  costPerEndpoint: number;
};

export type PricingCostSummary = {
  spendToday: number;
  spendWeek: number;
  spendMonth: number;
  projectedMonth: number;
  costPerSource: PricingCostPerSource[];
  costPerObservation: number;
  costTrend: { date: string; cost: number }[];
  monthlyBudgetUsd: number;
  budgetRemaining: number;
  budgetUsedPct: number;
  budgetWarningLevel: "OK" | "MEDIUM" | "HIGH" | "CRITICAL";
};

// ───────────────────────── Batch C: Data Curation & Admin Polish ─────────────────────────

export type PricingSkuAliasAdmin = {
  id: string;
  rawLabel: string;
  matchType: string;
  occurrenceCount: number;
};

export type PricingCanonicalSkuAdmin = {
  id: string;
  code: string;
  grade: string | null;
  sizeLabel: string | null;
  isActive: boolean;
  materialCategory: { code: string; name: string } | null;
  brandName: string | null;
  aliases: PricingSkuAliasAdmin[];
  productsLinked: number;
  districtCoverage: number;
  observationCount: number;
  lastSeen: string | null;
  confidence: string;
  unmappedCount: number;
};

export type PricingUnmappedQueueItem = {
  id: string;
  rawLabel: string;
  normalizedLabel: string;
  occurrenceCount: number;
  source: { code: string; name: string } | null;
  matchType: string;
  matchScore: number | null;
  firstSeen: string;
  lastSeen: string;
};

export type AdminAuditEntry = {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
};

export type PricingGlobalSearchResult = {
  districts: { id: string; code: string; name: string }[];
  categories: { id: string; code: string; name: string }[];
  skus: { id: string; code: string }[];
  aliases: { id: string; rawLabel: string; canonicalSkuId: string | null }[];
  sources: { id: string; code: string; name: string }[];
  anomalies: { id: string; reason: string; detail: string | null }[];
};

