import { KycReviewList } from "@/components/admin/KycReviewList";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

export default async function KycPage() {
  await requireMenu("kyc");

  const docs = await adminApiGet<Array<{ id: string; vendorName: string | null; type: string; createdAt: string }>>("/admin/kyc").catch(() => []);

  const items = docs.map((doc) => ({
    id: doc.id,
    vendor: doc.vendorName || "Unknown Vendor",
    document: doc.type,
    submittedAt: new Date(doc.createdAt).toLocaleString("en-IN"),
    status: "PENDING" as const,
  }));

  return <KycReviewList items={items} />;
}