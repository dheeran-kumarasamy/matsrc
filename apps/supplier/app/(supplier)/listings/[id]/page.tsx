export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getSupplierListingById } from "@/lib/supplier-data";

type Props = {
  params: { id: string };
};

// Product description page — reached by clicking a listing's name from
// `/listings` or the dashboard's Active Listings queue. Read-only summary of
// the listing with a prominent "Edit Listing" action; suppliers can jump
// straight into editing (price, images, etc.) from here at any time, even
// after the listing has been published.
export default async function ListingDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const listing = await getSupplierListingById(params.id, session.user.email);

  if (!listing) {
    return <div className="panel p-5 text-sm text-slate-600">Listing not found for this supplier.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/listings" className="text-sm font-semibold text-blue-700 hover:text-blue-900">
          ← Back to Listings
        </Link>
        <Link
          href={`/listings/${listing.id}/edit`}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
        >
          Edit Listing
        </Link>
      </div>

      <section className="panel space-y-5 p-5">
        <div>
          <h3 className="text-xl font-extrabold text-slate-900">{listing.title}</h3>
          <p className="text-sm text-slate-600">{listing.category}</p>
        </div>

        {listing.images.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto">
            {listing.images.map((src: string) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt={listing.title} className="h-32 w-32 rounded-lg border border-slate-200 object-cover" />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No product photos added yet.</p>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Grade</p>
            <p className="text-slate-800">{listing.grade || "NA"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Brand</p>
            <p className="text-slate-800">{listing.brand || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Unit</p>
            <p className="text-slate-800">{listing.unit}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Base Price</p>
            <p className="text-slate-800">INR {Number(listing.price).toLocaleString("en-IN")}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Max Serviceable Qty</p>
            <p className="text-slate-800">{listing.maxServiceableQty}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Group Pricing</p>
            <p className="text-slate-800">{listing.aggregationEnabled ? "Enabled" : "Disabled"}</p>
          </div>
        </div>

        {listing.description ? (
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Description</p>
            <p className="text-sm text-slate-700">{listing.description}</p>
          </div>
        ) : null}

        {listing.pricingTiers.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Pricing Tiers</p>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Min Qty</th>
                  <th className="px-3 py-2 font-semibold">Max Qty</th>
                  <th className="px-3 py-2 font-semibold">Price</th>
                </tr>
              </thead>
              <tbody>
                {listing.pricingTiers.map((tier: { minQty: string; maxQty: string; price: string }, index: number) => (
                  <tr key={index} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-700">{tier.minQty}</td>
                    <td className="px-3 py-2 text-slate-700">{tier.maxQty}</td>
                    <td className="px-3 py-2 text-slate-700">INR {Number(tier.price).toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
