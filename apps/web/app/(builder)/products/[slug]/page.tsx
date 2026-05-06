import PriceChart from "@/components/products/PriceChart";
import PriceGrid from "@/components/products/PriceGrid";
import AddToCartButton from "@/components/cart/AddToCartButton";
import WatchlistButton from "@/components/products/WatchlistButton";
import { Eye } from "lucide-react";
import { notFound } from "next/navigation";

interface Props {
  params: { slug: string };
}

type Listing = {
  id: string;
  title: string;
  description?: string;
  pricePerUnit: number;
  unit: string;
  category?: string;
  supplierName?: string;
  tags?: string[];
};

async function getListing(slug: string): Promise<Listing | null> {
  const base = process.env.SUPPLIER_APP_URL ?? "https://matsrc-supplier.vercel.app";
  try {
    const res = await fetch(`${base}/api/supplier/listings?q=${encodeURIComponent(slug)}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data: Listing[] = await res.json();
    // match by id or slug
    return data.find((l) => l.id === slug || l.title.toLowerCase().replace(/\s+/g, "-") === slug) ?? data[0] ?? null;
  } catch {
    return null;
  }
}

// UF-02 Steps 3–8: Product detail, price grid, chart, watchlist, add to cart
export default async function ProductDetailPage({ params }: Props) {
  const listing = await getListing(params.slug);
  if (!listing) notFound();

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-400 flex gap-2">
        <a href="/products" className="hover:text-blue-700">Materials</a>
        <span>/</span>
        <span className="text-slate-600 capitalize">{listing.title}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Product info */}
        <div className="lg:col-span-2 space-y-5">
          <div className="panel p-5">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{listing.title}</h1>
                {listing.description && (
                  <p className="text-sm text-slate-400 mt-1">{listing.description}</p>
                )}
              </div>
              {/* FR-36: Verified Quality Badge */}
              <span className="bg-green-50 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-green-200">
                ✓ Verified Quality
              </span>
            </div>

            {/* Images */}
            <div className="mt-4 h-48 bg-slate-100 rounded-lg flex items-center justify-center text-slate-300 text-sm">
              Product image
            </div>

            {/* Specs */}
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {[["Category", listing.category ?? "—"], ["Unit", listing.unit], ["Supplier", listing.supplierName ?? "—"]].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-400">{k}</span>
                  <span className="font-medium text-slate-700">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* FR-23: Price movement chart (7/30/90-day) */}
          <div className="panel p-5">
            <h2 className="font-semibold text-slate-800 mb-4">Price Trend</h2>
            <PriceChart productSlug={params.slug} />
          </div>

          {/* FR-21 & FR-22: Source city price grid */}
          <div className="panel p-5">
            <h2 className="font-semibold text-slate-800 mb-4">Source City Prices</h2>
            <PriceGrid productSlug={params.slug} />
          </div>
        </div>

        {/* Right: Buy panel */}
        <div className="space-y-4">
          <div className="panel p-5 sticky top-20">
            {/* Live price — FR-06 */}
            <div className="text-3xl font-bold text-slate-900">
              ₹{listing.pricePerUnit.toLocaleString("en-IN")} <span className="text-base font-normal text-slate-400">/ {listing.unit}</span>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Quantity (MT)</label>
                <input
                  type="number"
                  min={1}
                  defaultValue={1}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>

              <AddToCartButton productId={listing.id} />

              {/* FR-07: Watchlist */}
              <WatchlistButton productId={listing.id} />
            </div>

            {/* FR-05: Compare link */}
            <button className="mt-4 w-full flex items-center justify-center gap-2 text-xs text-blue-700 hover:underline">
              <Eye size={14} /> Add to Compare (up to 4)
            </button>

            {/* Supplier info */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-400 mb-2">Top supplier</p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-xs font-bold text-slate-500">S</div>
                <div>
                  <p className="text-sm font-medium text-slate-700">{listing.supplierName ?? "Verified Supplier"}</p>
                  <p className="text-xs text-slate-400">⭐ Verified</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
