import { AuditTimeline } from "@/components/admin/AuditTimeline";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

export default async function AuditPage() {
  await requireMenu("audit");

  const logs = await adminApiGet<Array<{ id: string; actorId: string; action: string; entityType: string; entityId: string; createdAt: string }>>("/admin/audit?limit=50").catch(() => []);

  const events = logs.map((log) => ({
    id: log.id,
    actor: log.actorId,
    action: log.action.toLowerCase().replace(/_/g, " "),
    target: `${log.entityType} ${log.entityId}`,
    time: new Date(log.createdAt).toLocaleString("en-IN"),
  }));

  return <AuditTimeline events={events} />;
}