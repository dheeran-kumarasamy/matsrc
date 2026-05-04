import { DisputeBoard } from "@/components/admin/DisputeBoard";

const disputes = [
  { id: "d-201", orderId: "98211", issue: "Short delivery claim", owner: "Ops Team A", sla: "18 hrs", severity: "HIGH" as const },
  { id: "d-204", orderId: "98198", issue: "Damaged goods", owner: "Ops Team B", sla: "31 hrs", severity: "MEDIUM" as const },
  { id: "d-209", orderId: "98088", issue: "Invoice mismatch", owner: "Finance Desk", sla: "22 hrs", severity: "MEDIUM" as const },
];

export default function DisputesPage() {
  return <DisputeBoard disputes={disputes} />;
}