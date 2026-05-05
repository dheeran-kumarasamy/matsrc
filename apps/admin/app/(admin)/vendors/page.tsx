import { VendorApprovalTable } from "@/components/admin/VendorApprovalTable";
import { adminApiGet } from "@/lib/api";

export default async function VendorsPage() {
  const vendorsRaw = await adminApiGet<Array<{ id: string; companyName: string | null; kycStatus: string }>>("/admin/vendors").catch(() => []);

  const vendors = vendorsRaw.map((vendor) => ({
    id: vendor.id,
    company: vendor.companyName || "Unnamed Supplier",
    category: "General",
    city: "—",
    risk: (vendor.kycStatus === "REJECTED" ? "HIGH" : vendor.kycStatus === "PENDING" ? "MEDIUM" : "LOW") as "LOW" | "MEDIUM" | "HIGH",
  }));

  return <VendorApprovalTable vendors={vendors} />;
}