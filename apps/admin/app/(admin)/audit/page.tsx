import { AuditTimeline } from "@/components/admin/AuditTimeline";

const events = [
  { id: "a1", actor: "Meera", action: "approved vendor", target: "Arka Steel Traders", time: "04 May · 10:10 IST" },
  { id: "a2", actor: "Ravi", action: "flagged KYC", target: "PAN mismatch for Metro Cement Hub", time: "04 May · 09:42 IST" },
  { id: "a3", actor: "Nila", action: "escalated dispute", target: "Short delivery claim on order #98211", time: "04 May · 09:15 IST" },
  { id: "a4", actor: "Suresh", action: "rejected vendor", target: "Warehouse proof missing for Prime Pipe Works", time: "04 May · 08:57 IST" },
];

export default function AuditPage() {
  return <AuditTimeline events={events} />;
}