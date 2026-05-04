import { KycReviewList } from "@/components/admin/KycReviewList";

const items = [
  { id: "kyc-11", vendor: "Metro Cement Hub", document: "PAN Document", submittedAt: "Today, 08:32", status: "FLAGGED" as const },
  { id: "kyc-12", vendor: "Arka Steel Traders", document: "Cancelled Cheque", submittedAt: "Today, 09:10", status: "PENDING" as const },
  { id: "kyc-13", vendor: "Prime Pipe Works", document: "GST Certificate", submittedAt: "Today, 09:41", status: "PENDING" as const },
];

export default function KycPage() {
  return <KycReviewList items={items} />;
}