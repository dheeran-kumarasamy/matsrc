import { DisputeBoard } from "@/components/admin/DisputeBoard";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

export default async function DisputesPage() {
  await requireMenu("disputes");

  const disputesRaw = await adminApiGet<Array<{ id: string; orderId: string; issueType: string; status: string }>>("/admin/disputes").catch(() => []);

  const disputes = disputesRaw.map((dispute) => ({
    id: dispute.id,
    orderId: dispute.orderId,
    issue: dispute.issueType,
    owner: "Ops Team",
    sla: dispute.status === "ESCALATED" ? "4 hrs" : "24 hrs",
    severity: (dispute.status === "ESCALATED" ? "HIGH" : "MEDIUM") as "MEDIUM" | "HIGH",
  }));

  return <DisputeBoard disputes={disputes} />;
}