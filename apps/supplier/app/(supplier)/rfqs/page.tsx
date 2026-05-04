import { RfqCard } from "@/components/supplier/RfqCard";

const rfqs = [
  { id: "7712", material: "TMT Bars Fe500", quantity: "35 MT", pincode: "560102", dueBy: "05 May, 06:00 PM" },
  { id: "7710", material: "OPC Cement 53", quantity: "1200 Bags", pincode: "600042", dueBy: "05 May, 11:30 AM" },
  { id: "7704", material: "River Sand", quantity: "4 Loads", pincode: "641045", dueBy: "06 May, 09:00 AM" },
];

export default function SupplierRfqsPage() {
  return (
    <section className="space-y-3">
      <div className="panel p-5">
        <h3 className="text-xl font-extrabold text-slate-900">Open RFQs</h3>
        <p className="text-sm text-slate-600">Respond quickly to improve ranking in builder procurement decisions.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rfqs.map((rfq) => (
          <RfqCard key={rfq.id} rfq={rfq} />
        ))}
      </div>
    </section>
  );
}