import { VendorApprovalTable } from "@/components/admin/VendorApprovalTable";

const vendors = [
  { id: "ven-101", company: "Arka Steel Traders", category: "Steel", city: "Chennai", risk: "LOW" as const },
  { id: "ven-102", company: "Metro Cement Hub", category: "Cement", city: "Bengaluru", risk: "MEDIUM" as const },
  { id: "ven-103", company: "Rudra Aggregates", category: "Aggregates", city: "Hyderabad", risk: "HIGH" as const },
  { id: "ven-104", company: "Prime Pipe Works", category: "Pipes", city: "Pune", risk: "MEDIUM" as const },
];

export default function VendorsPage() {
  return <VendorApprovalTable vendors={vendors} />;
}