import PriceChart from "@/components/products/PriceChart";
import PriceGrid from "@/components/products/PriceGrid";
import AddToCartButton from "@/components/cart/AddToCartButton";
import WatchlistButton from "@/components/products/WatchlistButton";
import { Eye } from "lucide-react";

interface Props {
  params: { slug: string };
}

// UF-02 Steps 3–8: Product detail, price grid, chart, watchlist, add to cart
export default async function ProductDetailPage({ params }: Props) {
  // Data fetched from API in production
  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-xs text-gray-400 flex gap-2">
        <a href="/products" className="hover:text-brand-500">Materials</a>
        <span>/</span>
        <span className="text-gray-600 capitalize">{params.slug.replace(/-/g, " ")}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Product info */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">TMT Bar Fe-500D</h1>
                <p className="text-sm text-gray-400 mt-1">IS 1786 · Grade Fe-500D · BIS Certified</p>
              </div>
              {/* FR-36: Verified Quality Badge */}
              <span className="bg-green-50 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-green-200">
                ✓ Verified Quality
              </span>
            </div>

            {/* Images */}
            <div className="mt-4 h-48 bg-gray-100 rounded-lg flex items-center justify-center text-gray-300 text-sm">
              Product image
            </div>

            {/* Specs */}
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {[["IS Code", "IS 1786"], ["Grade", "Fe-500D"], ["Unit", "MT"], ["BIS Status", "Certified"]].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-gray-50 pb-2">
                  <span className="text-gray-400">{k}</span>
                  <span className="font-medium text-gray-700">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* FR-23: Price movement chart (7/30/90-day) */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-800 mb-4">Price Trend</h2>
            <PriceChart productSlug={params.slug} />
          </div>

          {/* FR-21 & FR-22: Source city price grid */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-800 mb-4">Source City Prices</h2>
            <PriceGrid productSlug={params.slug} />
          </div>
        </div>

        {/* Right: Buy panel */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 p-5 sticky top-20">
            {/* Live price — FR-06 */}
            <div className="text-3xl font-bold text-gray-900">₹62,400 <span className="text-base font-normal text-gray-400">/ MT</span></div>
            <p className="text-xs text-green-600 mt-1">↓ ₹800 from yesterday</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Quantity (MT)</label>
                <input
                  type="number"
                  min={1}
                  defaultValue={1}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <AddToCartButton productId={params.slug} />

              {/* FR-07: Watchlist */}
              <WatchlistButton productId={params.slug} />
            </div>

            {/* FR-05: Compare link */}
            <button className="mt-4 w-full flex items-center justify-center gap-2 text-xs text-brand-500 hover:underline">
              <Eye size={14} /> Add to Compare (up to 4)
            </button>

            {/* Supplier info */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-2">Top supplier</p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-500">S</div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Raipur Steel Co.</p>
                  <p className="text-xs text-gray-400">⭐ 4.8 · 120 orders</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
