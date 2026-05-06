export const dynamic = "force-dynamic";

import Link from "next/link";
import { getSupplierListings } from "@/lib/supplier-data";

export default async function SupplierListingsPage() {
  const listings = await getSupplierListings();

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
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Grade</th>
              <th className="px-4 py-3 font-semibold">Price</th>
              <th className="px-4 py-3 font-semibold">Stock</th>
              <th className="px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((row: { id: string; name: string; category: string; grade: string; price: string; stock: string; active: boolean }) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold text-slate-800">{row.name}</td>
                <td className="px-4 py-3 text-slate-700">{row.category}</td>
                <td className="px-4 py-3 text-slate-700">{row.grade}</td>
                <td className="px-4 py-3 text-slate-700">{row.price}</td>
                <td className="px-4 py-3 text-slate-700">{row.stock}</td>
                <td className="px-4 py-3">
                  <Link href={`/listings/${row.id}/edit`} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {listings.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  No listings yet. Create your first product listing to appear in builder discovery.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}