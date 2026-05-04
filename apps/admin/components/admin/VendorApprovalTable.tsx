import Link from "next/link";

type Vendor = {
  id: string;
  company: string;
  category: string;
  city: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
};

const riskStyle: Record<Vendor["risk"], string> = {
  LOW: "bg-emerald-50 text-emerald-700",
  MEDIUM: "bg-amber-50 text-amber-700",
  HIGH: "bg-red-50 text-red-700",
};

export function VendorApprovalTable({ vendors }: { vendors: Vendor[] }) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-lg font-bold text-slate-950">Vendor Approval Queue</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Vendor</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">City</th>
              <th className="px-4 py-3 font-semibold">Risk</th>
              <th className="px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((vendor) => (
              <tr key={vendor.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold text-slate-800">{vendor.company}</td>
                <td className="px-4 py-3 text-slate-700">{vendor.category}</td>
                <td className="px-4 py-3 text-slate-700">{vendor.city}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${riskStyle[vendor.risk]}`}>{vendor.risk}</span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/vendors/${vendor.id}`} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}