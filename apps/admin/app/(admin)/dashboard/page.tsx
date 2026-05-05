import { AuditTimeline } from "@/components/admin/AuditTimeline";
import { DisputeBoard } from "@/components/admin/DisputeBoard";
import { MetricCard } from "@/components/admin/MetricCard";
import { VendorApprovalTable } from "@/components/admin/VendorApprovalTable";
import { adminApiGet } from "@/lib/api";

export default async function AdminDashboardPage() {
  const [summary, vendorsRaw, disputesRaw, auditRaw] = await Promise.all([
    adminApiGet<{ pendingVendors: number; pendingKyc: number; openDisputes: number; totalOrders: number }>("/admin/dashboard").catch(() => ({ pendingVendors: 0, pendingKyc: 0, openDisputes: 0, totalOrders: 0 })),
    adminApiGet<Array<{ id: string; companyName: string | null; kycStatus: string }>>("/admin/vendors").catch(() => []),
    adminApiGet<Array<{ id: string; orderId: string; issueType: string; status: string }>>("/admin/disputes").catch(() => []),
    adminApiGet<Array<{ id: string; actorId: string; action: string; entityType: string; entityId: string; createdAt: string }>>("/admin/audit?limit=5").catch(() => []),
  ]);

  const metrics = [
    { label: "Pending Vendors", value: String(summary.pendingVendors), hint: "Awaiting review" },
    { label: "KYC Docs Pending", value: String(summary.pendingKyc), hint: "Require document checks" },
    { label: "Open Disputes", value: String(summary.openDisputes), hint: "Need resolution" },
    { label: "Total Orders", value: String(summary.totalOrders), hint: "Across platform" },
  ];

  const vendors = vendorsRaw.slice(0, 3).map((vendor) => ({
    id: vendor.id,
    company: vendor.companyName || "Unnamed Supplier",
    category: "General",
    city: "—",
    risk: (vendor.kycStatus === "REJECTED" ? "HIGH" : vendor.kycStatus === "PENDING" ? "MEDIUM" : "LOW") as "LOW" | "MEDIUM" | "HIGH",
  }));

  const disputes = disputesRaw.slice(0, 3).map((dispute) => ({
    id: dispute.id,
    orderId: dispute.orderId,
    issue: dispute.issueType,
    owner: "Ops Team",
    sla: dispute.status === "ESCALATED" ? "4 hrs" : "24 hrs",
    severity: (dispute.status === "ESCALATED" ? "HIGH" : "MEDIUM") as "MEDIUM" | "HIGH",
  }));

  const events = auditRaw.map((event) => ({
    id: event.id,
    actor: event.actorId,
    action: event.action.toLowerCase().replace(/_/g, " "),
    target: `${event.entityType} ${event.entityId}`,
    time: new Date(event.createdAt).toLocaleString("en-IN"),
  }));

  return (
    <div className="space-y-4">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <VendorApprovalTable vendors={vendors} />
        <DisputeBoard disputes={disputes} />
      </section>
      <AuditTimeline events={events} />
    </div>
  );
}