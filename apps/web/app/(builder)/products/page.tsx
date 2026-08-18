import type { Metadata } from "next";
import ProductCard from "@/components/products/ProductCard";
import ProductFilters from "@/components/products/ProductFilters";
import Breadcrumbs from "@/components/products/Breadcrumbs";
import { catalogueBreadcrumbs, categoryBreadcrumbs } from "@/lib/breadcrumbs";
import { buildBreadcrumbJsonLd } from "@/lib/json-ld";
import { getSiteUrl } from "@/lib/site-url";
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

// P2-D — unique metadata per category-filtered view. Canonical URL policy:
// category-filtered catalogue pages ARE treated as distinct indexable
// discovery pages (they show genuinely different, real content — a filtered
// product set), so each gets its own canonical `?category=` URL rather than
// all collapsing to the bare /products canonical. Other filter params
// (brand/price/sort/q) are NOT given distinct canonicals — they narrow an
// already-indexable page rather than representing a separate discovery
// surface, so their canonical points back to the (optionally
// category-scoped) page without those params, avoiding duplicate indexation
// from irrelevant query-parameter combinations.
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const category = normalizeParam(searchParams.category);
  const siteUrl = getSiteUrl();

  if (category) {
    const canonical = `${siteUrl}/products?category=${encodeURIComponent(category)}`;
    return {
      title: `${category} — Buy Construction Materials Online`,
      description: `Compare live prices from verified suppliers for ${category} on Buildohub — India's B2B construction material procurement marketplace.`,
      alternates: { canonical },
    };
  }

  return {
    title: "Browse Materials",
    description: "Compare live prices from verified suppliers across cement, TMT bars, and more construction materials on Buildohub.",
    alternates: { canonical: `${siteUrl}/products` },
  };
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

  // Category/Brand cross-filter dependency data (BUG fix): a lightweight
  // {category, brand} pair list derived from the *full* active listings
  // set (before category/brand narrowing below), passed to ProductFilters
  // so it can compute which brands are valid for a selected category and
  // vice versa, and disable the options that don't apply.
  const listingFacets = filtered.map((listing) => ({
    category: listing.category,
    brand: listing.brand ?? "",
  }));

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

  // BUG-01 fix: filter against the real `brand` field now returned by the
  // public listings feed (see apps/supplier/lib/supplier-data.ts
  // getPublicSupplierListings()), instead of a name+grade substring hack
  // that had no reliable relationship to the actual brand.
  if (brand) {
    const selectedBrand = brand.toLowerCase();
    filtered = filtered.filter((listing) => (listing.brand ?? "").toLowerCase() === selectedBrand);
  }


  if (minPrice !== undefined || maxPrice !== undefined) {
    filtered = filtered.filter((listing) => {
      const price = parseListingPrice(listing.price);
      if (minPrice !== undefined && price < minPrice) return false;
      if (maxPrice !== undefined && price > maxPrice) return false;
      return true;
    });
  }

  // BUG-04 fix: the sort dropdown previously had no branch for "newest"
  // (the third <option> in ProductFilters.tsx), so selecting it silently did
  // nothing — the list stayed in whatever order dedupe/filter left it in.
  // Now every option offered in the UI has an explicit, working sort:
  // - price_asc / price_desc: numeric compare on the parsed listing price.
  // - newest: sort by the listing's `updatedAt` timestamp (now exposed by
  //   getPublicSupplierListings(), which already queries `orderBy:
  //   { updatedAt: "desc" }`) descending, so the most recently
  //   created/updated listings surface first regardless of upstream order.
  if (sort === "price_desc") {
    filtered.sort((a, b) => parseListingPrice(b.price) - parseListingPrice(a.price));
  } else if (sort === "price_asc") {
    filtered.sort((a, b) => parseListingPrice(a.price) - parseListingPrice(b.price));
  } else if (sort === "newest") {
    filtered.sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
  }


  // P0 fix (Phase 9): previously every card was given a fabricated
  // `rating: 4.6` and `change: 0` ("↑ 0% today") with no underlying data
  // source — there is no ratings/day-over-day pricing feed wired into this
  // page. Replaced with a truthful, data-backed value: the number of
  // suppliers actually quoting this canonical product (from
  // `groupedListingIds`, populated by dedupeByCanonicalGroup()/the
  // cross-supplier resolution in apps/supplier/lib/supplier-data.ts).
  const cardProducts = filtered.map((listing) => ({
    slug: listing.id,
    name: listing.name,
    price: parseListingPrice(listing.price),
    minPrice: listing.minPrice ?? undefined,
    maxPrice: listing.maxPrice ?? undefined,
    supplier: "Verified Supplier",
    supplierCount: listing.groupedListingIds?.length || 1,
    image: listing.images && listing.images.length > 0 ? listing.images[0] : undefined,
    category: listing.category,
  }));


  // P2-C — the category name in the crumb must be the real, admin-configured
  // Category name (matching what the filter/link actually uses), not the raw
  // free-text query param, so it stays accurate even if a user hand-edits
  // the URL with different casing.
  const matchedCategoryName =
    category && filtered.length > 0
      ? filtered.find((l) => l.category.toLowerCase().includes(category.toLowerCase()))?.category ?? category
      : category;
  const breadcrumbItems = matchedCategoryName ? categoryBreadcrumbs(matchedCategoryName) : catalogueBreadcrumbs();

  return (
    <div className="space-y-4">
      {/* P2-D — BreadcrumbList JSON-LD, derived from the exact same
          breadcrumbItems the visible <Breadcrumbs> renders (single source
          of truth, see lib/breadcrumbs.ts / lib/json-ld.ts). */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbJsonLd(breadcrumbItems)) }}
      />
      <Breadcrumbs items={breadcrumbItems} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Browse Materials</h1>
        <span className="text-sm text-slate-400">{cardProducts.length} live listings from suppliers</span>
      </div>

      {/* Filters — a single horizontal line directly below the persistent
          header search bar, in the space left by the removed duplicate
          search input. Category, Brand, Price range, and Sort all sit on
          one row (wrapping on narrow screens). Sticky so it stays visible
          alongside the header search bar while scrolling the product grid. */}
      <div className="sticky top-[88px] z-20">
        <ProductFilters
          selectedCategory={category}
          selectedBrand={brand}
          minPrice={minPriceRaw}
          maxPrice={maxPriceRaw}
          q={q}
          sort={sort}
          listingFacets={listingFacets}
        />

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
  );
}
