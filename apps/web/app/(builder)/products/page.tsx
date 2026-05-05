import ProductFilters from "@/components/products/ProductFilters";
import ProductCard from "@/components/products/ProductCard";

interface SearchParams {
  category?: string;
  brand?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  q?: string;
}

// UF-02: Material Discovery — FR-04 Faceted Search & Browse
export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Browse Materials</h1>
        <span className="text-sm text-slate-400">Live prices from all suppliers</span>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar filters — FR-04 */}
        <aside className="w-full md:w-64 shrink-0">
          <ProductFilters />
        </aside>

        {/* Product grid */}
        <div className="flex-1">
          {/* Search bar */}
          <form method="GET" className="mb-4">
            <input
              name="q"
              defaultValue={searchParams.q}
              placeholder="Search TMT bars, cement, bricks..."
              className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </form>

          {/* Sort */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-slate-400">Showing live market prices</p>
            <select
              name="sort"
              className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="rating">Top Rated</option>
              <option value="newest">Newest</option>
            </select>
          </div>

          {/* Products grid — populated via server data in production */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Placeholder cards — replaced with real data from API */}
            {Array.from({ length: 6 }).map((_, i) => (
              <ProductCard key={i} skeleton />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
