import { PricingAnomalyBoard, type AdminPricingAnomaly } from "@/components/admin/PricingAnomalyBoard";
import { PricingDashboardPanel } from "@/components/admin/pricing/PricingDashboardPanel";
import { SourceManagementPanel } from "@/components/admin/pricing/SourceManagementPanel";
import { EndpointHealthPanel } from "@/components/admin/pricing/EndpointHealthPanel";
import { SchedulerDashboardPanel } from "@/components/admin/pricing/SchedulerDashboardPanel";
import { RollupAdministrationPanel } from "@/components/admin/pricing/RollupAdministrationPanel";
import { CoverageMatrixPanel } from "@/components/admin/pricing/CoverageMatrixPanel";
import { DataQualityDashboardPanel } from "@/components/admin/pricing/DataQualityDashboardPanel";
import { ComplianceDashboardPanel } from "@/components/admin/pricing/ComplianceDashboardPanel";
import { CostDashboardPanel } from "@/components/admin/pricing/CostDashboardPanel";
import { CanonicalSkuManagementPanel } from "@/components/admin/pricing/CanonicalSkuManagementPanel";
import { UnmappedQueuePanel } from "@/components/admin/pricing/UnmappedQueuePanel";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";
import type {
  PricingAdminEndpoint,
  PricingAdminSource,
  PricingCanonicalSkuAdmin,
  PricingComplianceSummary,
  PricingCostSummary,
  PricingCoverageMatrix,
  PricingDashboardSummary,
  PricingDataQualitySummary,
  PricingRollupStatus,
  PricingSchedulerStatus,
  PricingUnmappedQueueItem,
} from "@/lib/pricing-admin-types";

type BackendAnomaly = {
  id: string;
  reason: string;
  detail: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  resolutionAction: string | null;
  observation: {
    canonicalSku: { id: string; code: string } | null;
    district: { id: string; code: string; name: string } | null;
    source: { id: string; code: string; name: string } | null;
  } | null;
};

export default async function PricingPage() {
  await requireMenu("pricing");

  const [
    dashboard,
    sources,
    endpoints,
    scheduler,
    rollupStatus,
    anomaliesRaw,
    coverageMatrix,
    dataQuality,
    compliance,
    costs,
    canonicalSkus,
    unmappedQueue,
  ] = await Promise.all([
    adminApiGet<PricingDashboardSummary>("/admin/pricing/dashboard").catch(() => null),
    adminApiGet<PricingAdminSource[]>("/admin/pricing/sources").catch(() => [] as PricingAdminSource[]),
    adminApiGet<PricingAdminEndpoint[]>("/admin/pricing/endpoints").catch(() => [] as PricingAdminEndpoint[]),
    adminApiGet<PricingSchedulerStatus>("/admin/pricing/scheduler").catch(() => null),
    adminApiGet<PricingRollupStatus>("/admin/pricing/rollups/status").catch(() => null),
    adminApiGet<BackendAnomaly[]>("/admin/pricing/anomalies").catch(() => [] as BackendAnomaly[]),
    adminApiGet<PricingCoverageMatrix>("/admin/pricing/coverage-matrix").catch(() => null),
    adminApiGet<PricingDataQualitySummary>("/admin/pricing/data-quality").catch(() => null),
    adminApiGet<PricingComplianceSummary>("/admin/pricing/compliance").catch(() => null),
    adminApiGet<PricingCostSummary>("/admin/pricing/costs").catch(() => null),
    adminApiGet<PricingCanonicalSkuAdmin[]>("/admin/pricing/sku/canonical").catch(
      () => [] as PricingCanonicalSkuAdmin[]
    ),
    adminApiGet<PricingUnmappedQueueItem[]>("/admin/pricing/sku/unmapped").catch(
      () => [] as PricingUnmappedQueueItem[]
    ),
  ]);

  const anomalies: AdminPricingAnomaly[] = anomaliesRaw.map((anomaly) => ({
    id: anomaly.id,
    reason: anomaly.reason,
    detail: anomaly.detail,
    detectedAt: anomaly.detectedAt,
    resolvedAt: anomaly.resolvedAt,
    resolutionAction: anomaly.resolutionAction,
    canonicalSkuCode: anomaly.observation?.canonicalSku?.code ?? null,
    districtCode: anomaly.observation?.district?.code ?? null,
    districtName: anomaly.observation?.district?.name ?? null,
    sourceCode: anomaly.observation?.source?.code ?? null,
    sourceName: anomaly.observation?.source?.name ?? null,
  }));

  return (
    <div className="space-y-6">
      <PricingDashboardPanel summary={dashboard} />
      <SourceManagementPanel sources={sources} />
      <EndpointHealthPanel endpoints={endpoints} />
      <CoverageMatrixPanel matrix={coverageMatrix} />
      <CanonicalSkuManagementPanel skus={canonicalSkus} />
      <UnmappedQueuePanel items={unmappedQueue} />
      <DataQualityDashboardPanel summary={dataQuality} />
      <ComplianceDashboardPanel summary={compliance} />
      <CostDashboardPanel summary={costs} />
      <SchedulerDashboardPanel status={scheduler} />
      <RollupAdministrationPanel status={rollupStatus} />
      <PricingAnomalyBoard anomalies={anomalies} />
    </div>
  );
}
