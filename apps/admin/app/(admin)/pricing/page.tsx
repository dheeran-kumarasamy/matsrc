import { PricingAnomalyBoard, type AdminPricingAnomaly } from "@/components/admin/PricingAnomalyBoard";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

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

  const anomaliesRaw = await adminApiGet<BackendAnomaly[]>("/admin/pricing/anomalies").catch(() => []);

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

  return <PricingAnomalyBoard anomalies={anomalies} />;
}
