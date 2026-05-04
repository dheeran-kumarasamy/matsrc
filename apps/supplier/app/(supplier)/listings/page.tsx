import Link from "next/link";

const listings = [
  { id: "lst-101", name: "TMT Bars 12mm", city: "Chennai", price: "₹61,250 / MT", stock: "120 MT" },
  { id: "lst-102", name: "OPC Cement 53", city: "Coimbatore", price: "₹372 / bag", stock: "24,000 bags" },
  { id: "lst-103", name: "M Sand", city: "Salem", price: "₹1,850 / ton", stock: "75 tons" },
];

export default function SupplierListingsPage() {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-xl font-extrabold text-slate-900">Your Listings</h3>
          <p className="text-sm text-slate-600">Manage price visibility, MOQ, and dispatch city per SKU.</p>
        </div>
        <Link href="/listings/new" className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white">
          New Listing
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Material</th>
              <th className="px-4 py-3 font-semibold">Dispatch City</th>
              <th className="px-4 py-3 font-semibold">Price</th>
              <th className="px-4 py-3 font-semibold">Stock</th>
              <th className="px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold text-slate-800">{row.name}</td>
                <td className="px-4 py-3 text-slate-700">{row.city}</td>
                <td className="px-4 py-3 text-slate-700">{row.price}</td>
                <td className="px-4 py-3 text-slate-700">{row.stock}</td>
                <td className="px-4 py-3">
                  <Link href={`/listings/${row.id}/edit`} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">
                    Edit
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