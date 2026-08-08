import { AuditTimeline } from "@/components/admin/AuditTimeline";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type BackendAuditLog = {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: { category?: string };
}) {
  await requireMenu("audit");

  const category = searchParams?.category;
  const qs = new URLSearchParams({ limit: "100" });
  if (category) qs.set("category", category);

  let logs: BackendAuditLog[] = [];
  let error: string | null = null;
  try {
    logs = await adminApiGet<BackendAuditLog[]>(`/admin/audit?${qs.toString()}`);
  } catch {
    error = "Unable to load the audit trail right now. Please retry in a moment.";
  }

  const events = logs.map((log) => ({
    id: log.id,
    actorId: log.actorId,
    actor: log.actorId,
    action: log.action.toLowerCase().replace(/_/g, " "),
    entityType: log.entityType,
    entityId: log.entityId,
    target: `${log.entityType} ${log.entityId}`,
    createdAt: log.createdAt,
    time: new Date(log.createdAt).toLocaleString("en-IN"),
  }));

  return <AuditTimeline events={events} error={error} />;
}
