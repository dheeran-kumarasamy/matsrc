"use client";

import { useEffect, useMemo, useState } from "react";

// Fetched via this app's own internal proxy route (direct-Prisma
// implementation, see apps/web/app/api/proxy/public/catalog/[entity]/route.ts)
// rather than NEXT_PUBLIC_API_URL (defaults to unreachable localhost:4000 in
// production), which previously caused net::ERR_CONNECTION_REFUSED and left
// the Category/Brand filters permanently empty.
const CATALOG_API_BASE_URL = "/api/proxy/public/catalog";


type CatalogOption = { id: string; name: string; code?: string | null };

function useCatalogOptions(entity: "category" | "brand" | "grade" | "unit") {
  const [options, setOptions] = useState<CatalogOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const response = await fetch(`${CATALOG_API_BASE_URL}/${entity}`, {

          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Failed to load ${entity} options`);
        }
        const data = (await response.json()) as CatalogOption[];
        if (!cancelled) {
          setOptions(data);
        }
      } catch {
        if (!cancelled) {
          setOptions([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [entity]);

  return { options, loading };
}

// A minimal {category, brand} pair per active listing, used to derive which
// brands are valid for a given category and vice versa (BUG FIX: bidirectional
// category<->brand filter dependency). Passed down from the server page,
// which already has the full listings dataset with both fields.
type ListingFacet = { category: string; brand: string };

type ProductFiltersProps = {
  selectedCategory?: string;
  selectedBrand?: string;
  minPrice?: string;
  maxPrice?: string;
  q?: string;
  sort?: string;
  listingFacets?: ListingFacet[];
};

// FR-04: Faceted filter bar
// Category and Brand are sourced from admin-configured master data
// (GET /public/catalog/:entity) instead of hardcoded free-text lists, so
// builders can only filter by the standardized set of values.
// Rendered as a single horizontal line above the product grid (below the
// persistent header search bar) so every filter + sort control fits on one
// row on desktop, wrapping gracefully on smaller screens.
//
// BUG FIX: Category and Brand now filter each other bidirectionally.
// Selecting a category disables (greys out, non-clickable) any brand option
// that has no active listing in that category, and vice versa. Clearing a
// selection (choosing "All Categories"/"All Brands") restores full options
// on both sides. This is computed client-side from `listingFacets` (the
// real category/brand pairs present in the currently active listings),
// while the actual product filtering on submit remains fully server-driven
// and unchanged.
export default function ProductFilters({
  selectedCategory,
  selectedBrand,
  minPrice,
  maxPrice,
  q,
  sort,
  listingFacets = [],
}: ProductFiltersProps) {
  const { options: categoryOptions, loading: categoriesLoading } = useCatalogOptions("category");
  const { options: brandOptions, loading: brandsLoading } = useCatalogOptions("brand");

  // Controlled state so selecting one filter can react to / reset the other.
  const [category, setCategory] = useState(selectedCategory ?? "");
  const [brand, setBrand] = useState(selectedBrand ?? "");

  // Keep local state in sync if the server re-renders with different
  // searchParams-derived props (e.g. browser back/forward navigation).
  useEffect(() => {
    setCategory(selectedCategory ?? "");
  }, [selectedCategory]);
  useEffect(() => {
    setBrand(selectedBrand ?? "");
  }, [selectedBrand]);

  // Derive category<->brand relationship maps from the real listing data.
  const { brandsForCategory, categoriesForBrand } = useMemo(() => {
    const brandsByCategory = new Map<string, Set<string>>();
    const categoriesByBrand = new Map<string, Set<string>>();

    for (const facet of listingFacets) {
      const facetCategory = (facet.category ?? "").trim();
      const facetBrand = (facet.brand ?? "").trim();
      if (!facetCategory || !facetBrand) continue;

      const categoryKey = facetCategory.toLowerCase();
      const brandKey = facetBrand.toLowerCase();

      if (!brandsByCategory.has(categoryKey)) brandsByCategory.set(categoryKey, new Set());
      brandsByCategory.get(categoryKey)!.add(brandKey);

      if (!categoriesByBrand.has(brandKey)) categoriesByBrand.set(brandKey, new Set());
      categoriesByBrand.get(brandKey)!.add(categoryKey);
    }

    return { brandsForCategory: brandsByCategory, categoriesForBrand: categoriesByBrand };
  }, [listingFacets]);

  // Options enabled for the Brand select, given the currently selected category.
  const allowedBrandKeys = category ? brandsForCategory.get(category.toLowerCase()) : undefined;
  // Options enabled for the Category select, given the currently selected brand.
  const allowedCategoryKeys = brand ? categoriesForBrand.get(brand.toLowerCase()) : undefined;

  function handleCategoryChange(nextCategory: string) {
    setCategory(nextCategory);
    // If the currently selected brand is no longer valid for the new
    // category, clear it so the user isn't stuck with a mismatched pair.
    if (nextCategory && brand) {
      const validBrands = brandsForCategory.get(nextCategory.toLowerCase());
      if (validBrands && !validBrands.has(brand.toLowerCase())) {
        setBrand("");
      }
    }
  }

  function handleBrandChange(nextBrand: string) {
    setBrand(nextBrand);
    // If the currently selected category is no longer valid for the new
    // brand, clear it so the user isn't stuck with a mismatched pair.
    if (nextBrand && category) {
      const validCategories = categoriesForBrand.get(nextBrand.toLowerCase());
      if (validCategories && !validCategories.has(category.toLowerCase())) {
        setCategory("");
      }
    }
  }

  return (
    <form
      method="GET"
      className="panel flex flex-wrap items-end gap-3 p-3"
    >
      {/* Preserve top-bar state when applying filters */}
      {q ? <input type="hidden" name="q" value={q} /> : null}

      {/* Category */}
      <div className="min-w-[140px] flex-1">
        <label className="mb-1 block text-[11px] font-medium text-slate-500">Category</label>
        <select
          name="category"
          value={category}
          onChange={(e) => handleCategoryChange(e.target.value)}
          disabled={categoriesLoading}
          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-700"
        >
          <option value="">All Categories</option>
          {categoryOptions.map((c) => {
            const disabled = allowedCategoryKeys ? !allowedCategoryKeys.has(c.name.toLowerCase()) : false;
            return (
              <option key={c.id} value={c.name} disabled={disabled}>
                {c.name}
              </option>
            );
          })}
        </select>
      </div>

      {/* Brand */}
      <div className="min-w-[140px] flex-1">
        <label className="mb-1 block text-[11px] font-medium text-slate-500">Brand</label>
        <select
          name="brand"
          value={brand}
          onChange={(e) => handleBrandChange(e.target.value)}
          disabled={brandsLoading}
          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-700"
        >
          <option value="">All Brands</option>
          {brandOptions.map((b) => {
            const disabled = allowedBrandKeys ? !allowedBrandKeys.has(b.name.toLowerCase()) : false;
            return (
              <option key={b.id} value={b.name} disabled={disabled}>
                {b.name}
              </option>
            );
          })}
        </select>
      </div>

      {/* Price range */}
      <div className="min-w-[100px]">
        <label className="mb-1 block text-[11px] font-medium text-slate-500">Min Price (₹/MT)</label>
        <input
          type="number"
          name="minPrice"
          defaultValue={minPrice}
          placeholder="Min"
          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-700"
        />
      </div>
      <div className="min-w-[100px]">
        <label className="mb-1 block text-[11px] font-medium text-slate-500">Max Price (₹/MT)</label>
        <input
          type="number"
          name="maxPrice"
          defaultValue={maxPrice}
          placeholder="Max"
          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-700"
        />
      </div>

      {/* Sort */}
      <div className="min-w-[140px]">
        <label className="mb-1 block text-[11px] font-medium text-slate-500">Sort</label>
        <select
          name="sort"
          defaultValue={sort}
          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-700"
        >
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
          <option value="newest">Newest</option>
        </select>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-800"
        >
          Apply Filters
        </button>
        <a
          href="/products"
          className="whitespace-nowrap px-2 py-2 text-xs text-slate-400 hover:text-slate-600"
        >
          Clear all
        </a>
      </div>
    </form>
  );
}
