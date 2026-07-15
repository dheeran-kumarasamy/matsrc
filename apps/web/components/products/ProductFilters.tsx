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

// FR-04: Faceted filter sidebar
// Category and Brand are now sourced from admin-configured master data
// (GET /public/catalog/:entity) instead of hardcoded free-text lists, so
// builders can only filter by the standardized set of values.
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
    <form method="GET" className="panel p-4 space-y-5">
      <h3 className="font-semibold text-sm text-slate-800">Filters</h3>

      {/* Preserve top-bar state when applying sidebar filters */}
      {q ? <input type="hidden" name="q" value={q} /> : null}
      {sort ? <input type="hidden" name="sort" value={sort} /> : null}

      {/* Category */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-2">Category</p>
        {categoriesLoading ? (
          <p className="text-xs text-slate-400">Loading...</p>
        ) : (
          categoryOptions.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-xs text-slate-600 mb-1.5 cursor-pointer">
              <input
                type="radio"
                name="category"
                value={c.name}
                defaultChecked={selectedCategory === c.name}
                className="accent-blue-700"
              /> {c.name}
            </label>
          ))
        )}
      </div>

      {/* Price range */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-2">Price Range (₹/MT)</p>
        <div className="flex gap-2">
          <input
            type="number"
            name="minPrice"
            defaultValue={minPrice}
            placeholder="Min"
            className="w-full border border-slate-200 rounded px-2 py-1 text-xs"
          />
          <input
            type="number"
            name="maxPrice"
            defaultValue={maxPrice}
            placeholder="Max"
            className="w-full border border-slate-200 rounded px-2 py-1 text-xs"
          />
        </div>
      </div>

      {/* Brand */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-2">Brand</p>
        {brandsLoading ? (
          <p className="text-xs text-slate-400">Loading...</p>
        ) : (
          brandOptions.map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-xs text-slate-600 mb-1.5 cursor-pointer">
              <input
                type="radio"
                name="brand"
                value={b.name}
                defaultChecked={selectedBrand === b.name}
                className="accent-blue-700"
              /> {b.name}
            </label>
          ))
        )}
      </div>

      {/* BIS Certified only */}
      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
        <input type="checkbox" disabled className="accent-blue-700" />
        BIS Certified only
      </label>

      {/* Verified suppliers only */}
      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
        <input type="checkbox" disabled className="accent-blue-700" />
        Verified Quality Badge only
      </label>

      <button type="submit" className="w-full bg-blue-700 text-white rounded-lg py-2 text-xs font-medium hover:bg-blue-800 transition-colors">Apply Filters</button>
      <a href="/products" className="block w-full text-center text-xs text-slate-400 hover:text-slate-600">Clear all</a>
    </form>
  );
}
