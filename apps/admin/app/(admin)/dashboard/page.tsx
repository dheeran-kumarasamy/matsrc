import { AuditTimeline } from "@/components/admin/AuditTimeline";
import { DisputeBoard } from "@/components/admin/DisputeBoard";
import { MetricCard } from "@/components/admin/MetricCard";
import { VendorApprovalTable } from "@/components/admin/VendorApprovalTable";

const metrics = [
  { label: "Pending Vendors", value: "12", hint: "4 high-risk submissions" },
  { label: "KYC Docs Pending", value: "31", hint: "11 flagged for mismatch" },
  { label: "Open Disputes", value: "9", hint: "3 nearing SLA breach" },
  { label: "Audit Events", value: "284", hint: "Last 24 hours" },
];

const vendors = [
  { id: "ven-101", company: "Arka Steel Traders", category: "Steel", city: "Chennai", risk: "LOW" as const },
  { id: "ven-102", company: "Metro Cement Hub", category: "Cement", city: "Bengaluru", risk: "MEDIUM" as const },
  { id: "ven-103", company: "Rudra Aggregates", category: "Aggregates", city: "Hyderabad", risk: "HIGH" as const },
];

const disputes = [
  { id: "d-201", orderId: "98211", issue: "Short delivery claim", owner: "Ops Team A", sla: "18 hrs", severity: "HIGH" as const },
  { id: "d-204", orderId: "98198", issue: "Damaged goods", owner: "Ops Team B", sla: "31 hrs", severity: "MEDIUM" as const },
];

const events = [
  { id: "a1", actor: "Meera", action: "approved vendor", target: "Arka Steel Traders", time: "04 May · 10:10 IST" },
  { id: "a2", actor: "Ravi", action: "flagged KYC", target: "PAN mismatch for Metro Cement Hub", time: "04 May · 09:42 IST" },
  { id: "a3", actor: "Nila", action: "escalated dispute", target: "Short delivery claim on order #98211", time: "04 May · 09:15 IST" },
];

export default function AdminDashboardPage() {
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