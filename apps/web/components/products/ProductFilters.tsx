"use client";

import { useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

type CatalogOption = { id: string; name: string; code?: string | null };

function useCatalogOptions(entity: "category" | "brand" | "grade" | "unit") {
  const [options, setOptions] = useState<CatalogOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE_URL}/public/catalog/${entity}`, {
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

type ProductFiltersProps = {
  selectedCategory?: string;
  selectedBrand?: string;
  minPrice?: string;
  maxPrice?: string;
  q?: string;
  sort?: string;
};

// FR-04: Faceted filter bar
// Category and Brand are sourced from admin-configured master data
// (GET /public/catalog/:entity) instead of hardcoded free-text lists, so
// builders can only filter by the standardized set of values.
// Rendered as a single horizontal line above the product grid (below the
// persistent header search bar) so every filter + sort control fits on one
// row on desktop, wrapping gracefully on smaller screens.
export default function ProductFilters({
  selectedCategory,
  selectedBrand,
  minPrice,
  maxPrice,
  q,
  sort,
}: ProductFiltersProps) {
  const { options: categoryOptions, loading: categoriesLoading } = useCatalogOptions("category");
  const { options: brandOptions, loading: brandsLoading } = useCatalogOptions("brand");

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
          defaultValue={selectedCategory ?? ""}
          disabled={categoriesLoading}
          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-700"
        >
          <option value="">All Categories</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Brand */}
      <div className="min-w-[140px] flex-1">
        <label className="mb-1 block text-[11px] font-medium text-slate-500">Brand</label>
        <select
          name="brand"
          defaultValue={selectedBrand ?? ""}
          disabled={brandsLoading}
          className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-700"
        >
          <option value="">All Brands</option>
          {brandOptions.map((b) => (
            <option key={b.id} value={b.name}>
              {b.name}
            </option>
          ))}
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
