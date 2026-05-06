import ProductFilters from "@/components/products/ProductFilters";
import ProductCard from "@/components/products/ProductCard";

export const dynamic = "force-dynamic";

const SUPPLIER_APP_URL = process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";

interface SearchParams {
  category?: string;
  brand?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  q?: string;
}

function parseNumber(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseListingPrice(value: string) {
  const numeric = value.replace(/[^\d.]/g, "");
  return Number(numeric || 0);
}

type SupplierListing = {
  id: string;
  name: string;
  category: string;
  grade: string;
  price: string;
  stock: string;
  active: boolean;
};

async function getSupplierListings(): Promise<SupplierListing[]> {
  const response = await fetch(`${SUPPLIER_APP_URL}/api/supplier/listings`, {
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  return response.json() as Promise<SupplierListing[]>;
}

// UF-02: Material Discovery — FR-04 Faceted Search & Browse
export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const minPrice = parseNumber(searchParams.minPrice);
  const maxPrice = parseNumber(searchParams.maxPrice);
  const listings = await getSupplierListings();

  let filtered = listings.filter((listing) => listing.active);

  if (searchParams.q) {
    const q = searchParams.q.toLowerCase();
    filtered = filtered.filter((listing) => {
      const haystack = `${listing.name} ${listing.category} ${listing.grade}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  if (searchParams.category) {
    const category = searchParams.category.toLowerCase();
    filtered = filtered.filter((listing) => listing.category.toLowerCase().includes(category));
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    filtered = filtered.filter((listing) => {
      const price = parseListingPrice(listing.price);
      if (minPrice !== undefined && price < minPrice) return false;
      if (maxPrice !== undefined && price > maxPrice) return false;
      return true;
    });
  }

  if (searchParams.sort === "price_desc") {
    filtered.sort((a, b) => parseListingPrice(b.price) - parseListingPrice(a.price));
  } else if (searchParams.sort === "price_asc") {
    filtered.sort((a, b) => parseListingPrice(a.price) - parseListingPrice(b.price));
  }

  const cardProducts = filtered.map((listing) => ({
    slug: listing.id,
    name: listing.name,
    price: parseListingPrice(listing.price),
    supplier: "Verified Supplier",
    rating: 4.6,
    change: 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Browse Materials</h1>
        <span className="text-sm text-slate-400">{cardProducts.length} live listings from suppliers</span>
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
            <p className="text-xs text-slate-400">Showing active supplier listings</p>
            <select
              name="sort"
              defaultValue={searchParams.sort ?? "price_asc"}
              className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none"
            >
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="newest">Newest</option>
            </select>
          </div>

          {/* Products grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cardProducts.map((product: any) => (
              <ProductCard key={product.slug} product={product} />
            ))}
            {cardProducts.length === 0 ? (
              <div className="panel p-8 text-center text-sm text-slate-500 sm:col-span-2 lg:col-span-3">
                No products found for the selected filters.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
