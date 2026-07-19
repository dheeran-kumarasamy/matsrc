import ProductCard from "@/components/products/ProductCard";
import { getSupplierListings, dedupeByCanonicalGroup, parseListingPrice } from "@/lib/listings";


export const dynamic = "force-dynamic";

interface SearchParams {
  category?: string;
  brand?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  q?: string;
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function parseNumber(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// UF-02: Material Discovery — FR-04 Faceted Search & Browse
export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const q = normalizeParam(searchParams.q);
  const category = normalizeParam(searchParams.category);
  const brand = normalizeParam(searchParams.brand);
  const minPriceRaw = normalizeParam(searchParams.minPrice);
  const maxPriceRaw = normalizeParam(searchParams.maxPrice);
  const sort = normalizeParam(searchParams.sort) ?? "price_asc";

  const minPrice = parseNumber(minPriceRaw);
  const maxPrice = parseNumber(maxPriceRaw);
  const allListings = await getSupplierListings();

  let filtered = allListings.filter((listing) => listing.active);

  // Collapse cross-supplier duplicate listings for the same canonical
  // product into a single card, priced at the group's lowest price
  // (headlinePrice) — fixes the Display bug from the cross-supplier price
  // resolution spec. Done BEFORE search/filter/sort so those operate on the
  // already-deduped, headline-priced representative listings.
  filtered = dedupeByCanonicalGroup(filtered);

  if (q) {
    const query = q.toLowerCase();
    filtered = filtered.filter((listing) => {
      const haystack = `${listing.name} ${listing.category} ${listing.grade}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  if (category) {
    const selectedCategory = category.toLowerCase();
    filtered = filtered.filter((listing) => listing.category.toLowerCase().includes(selectedCategory));
  }

  if (brand) {
    const selectedBrand = brand.toLowerCase();
    filtered = filtered.filter((listing) => {
      const haystack = `${listing.name} ${listing.grade}`.toLowerCase();
      return haystack.includes(selectedBrand);
    });
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    filtered = filtered.filter((listing) => {
      const price = parseListingPrice(listing.price);
      if (minPrice !== undefined && price < minPrice) return false;
      if (maxPrice !== undefined && price > maxPrice) return false;
      return true;
    });
  }

  if (sort === "price_desc") {
    filtered.sort((a, b) => parseListingPrice(b.price) - parseListingPrice(a.price));
  } else if (sort === "price_asc") {
    filtered.sort((a, b) => parseListingPrice(a.price) - parseListingPrice(b.price));
  }

  const cardProducts = filtered.map((listing) => ({
    slug: listing.id,
    name: listing.name,
    price: parseListingPrice(listing.price),
    minPrice: listing.minPrice ?? undefined,
    maxPrice: listing.maxPrice ?? undefined,
    supplier: "Verified Supplier",
    rating: 4.6,
    change: 0,
    image: listing.images && listing.images.length > 0 ? listing.images[0] : undefined,
    category: listing.category,
  }));


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Browse Materials</h1>
        <span className="text-sm text-slate-400">{cardProducts.length} live listings from suppliers</span>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Filters now render in the left-hand main menu sidebar (BuilderNav) — FR-04 */}

        {/* Product grid */}
        <div className="flex-1">

          {/* Sort / filter form — the search input lives in the persistent
              header bar (see (builder)/layout.tsx) so it isn't duplicated
              here; the current `q` value is preserved via a hidden field. */}
          <form method="GET" className="mb-4 space-y-3">
            {category ? <input type="hidden" name="category" value={category} /> : null}
            {brand ? <input type="hidden" name="brand" value={brand} /> : null}
            {minPriceRaw ? <input type="hidden" name="minPrice" value={minPriceRaw} /> : null}
            {maxPriceRaw ? <input type="hidden" name="maxPrice" value={maxPriceRaw} /> : null}
            {q ? <input type="hidden" name="q" value={q} /> : null}

            {/* Sort */}

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">Showing active supplier listings</p>
              <div className="flex items-center gap-2">
                <select
                  name="sort"
                  defaultValue={sort}
                  className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none"
                >
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="newest">Newest</option>
                </select>
                <button type="submit" className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-700">
                  Apply
                </button>
              </div>
            </div>
          </form>

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
