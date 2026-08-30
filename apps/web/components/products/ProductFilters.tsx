"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check, X } from "lucide-react";

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

type ListingFacet = { category: string; brand: string };

type ProductFiltersProps = {
  selectedCategory?: string | string[];
  selectedBrand?: string | string[];
  minPrice?: string;
  maxPrice?: string;
  q?: string;
  sort?: string;
  listingFacets?: ListingFacet[];
};

function toArray(value?: string | string[]): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
  }
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function MultiSelectDropdown({
  label,
  name,
  options,
  selected,
  onChange,
  allowedKeys,
  loading,
  placeholder,
}: {
  label: string;
  name: string;
  options: CatalogOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  allowedKeys?: Set<string>;
  loading?: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = (optionName: string) => {
    if (selected.includes(optionName)) {
      onChange(selected.filter((s) => s !== optionName));
    } else {
      onChange([...selected, optionName]);
    }
  };

  const clearSection = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const displayText =
    selected.length === 0
      ? placeholder
      : selected.length === 1
      ? selected[0]
      : `${selected.length} Selected`;

  return (
    <div ref={containerRef} className="relative min-w-[160px] flex-1">
      <label className="mb-1 block text-[11px] font-medium text-slate-500">{label}</label>

      {/* Hidden inputs so form GET submit naturally includes multi-values */}
      {selected.map((val) => (
        <input key={val} type="hidden" name={name} value={val} />
      ))}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={loading}
        className={
          "flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--posh-primary)] " +
          (selected.length > 0
            ? "border-[color:var(--posh-primary)] bg-[rgba(var(--posh-wash-rgb),0.08)] font-medium text-slate-900"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
        }
      >
        <span className="truncate pr-1">{displayText}</span>
        <div className="flex items-center gap-1 shrink-0">
          {selected.length > 0 && (
            <span
              onClick={clearSection}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              title={`Clear ${label}`}
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown size={14} className={"transition-transform duration-150 " + (open ? "rotate-180" : "")} />
        </div>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
          {loading ? (
            <div className="p-2 text-center text-xs text-slate-400">Loading...</div>
          ) : options.length === 0 ? (
            <div className="p-2 text-center text-xs text-slate-400">No options available</div>
          ) : (
            options.map((opt) => {
              const isChecked = selected.includes(opt.name);
              const isDisabled = allowedKeys ? !allowedKeys.has(opt.name.toLowerCase()) : false;
              return (
                <label
                  key={opt.id}
                  className={
                    "flex items-center justify-between rounded px-2.5 py-1.5 text-xs select-none transition-colors " +
                    (isDisabled
                      ? "opacity-40 cursor-not-allowed text-slate-400"
                      : isChecked
                      ? "bg-[rgba(var(--posh-wash-rgb),0.12)] font-semibold text-[color:var(--posh-primary)] cursor-pointer"
                      : "hover:bg-slate-50 text-slate-700 cursor-pointer")
                  }
                >
                  <div className="flex items-center gap-2 truncate">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isDisabled}
                      onChange={() => toggleOption(opt.name)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[color:var(--posh-primary)] focus:ring-[color:var(--posh-primary)]"
                    />
                    <span className="truncate">{opt.name}</span>
                  </div>
                  {isChecked && <Check size={12} className="text-[color:var(--posh-primary)] shrink-0 ml-1" />}
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// FR-04: Multi-Select Faceted filter bar
// Users can select multiple Brands and Categories simultaneously.
// Selections inside a group follow OR logic, across groups follow AND logic.
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

  const [categories, setCategories] = useState<string[]>(() => toArray(selectedCategory));
  const [brands, setBrands] = useState<string[]>(() => toArray(selectedBrand));

  useEffect(() => {
    setCategories(toArray(selectedCategory));
  }, [selectedCategory]);

  useEffect(() => {
    setBrands(toArray(selectedBrand));
  }, [selectedBrand]);

  // Derive category<->brand relationship maps from active listings facets.
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

  // Union of allowed keys when multiple selections exist
  const allowedBrandKeys = useMemo(() => {
    if (categories.length === 0) return undefined;
    const allowed = new Set<string>();
    for (const cat of categories) {
      const bSet = brandsForCategory.get(cat.toLowerCase());
      if (bSet) {
        bSet.forEach((b) => allowed.add(b));
      }
    }
    return allowed;
  }, [categories, brandsForCategory]);

  const allowedCategoryKeys = useMemo(() => {
    if (brands.length === 0) return undefined;
    const allowed = new Set<string>();
    for (const br of brands) {
      const cSet = categoriesForBrand.get(br.toLowerCase());
      if (cSet) {
        cSet.forEach((c) => allowed.add(c));
      }
    }
    return allowed;
  }, [brands, categoriesForBrand]);

  function handleCategoryChange(nextCategories: string[]) {
    setCategories(nextCategories);
    // Prune brands no longer valid for the newly selected categories
    if (nextCategories.length > 0 && brands.length > 0) {
      const validBrands = new Set<string>();
      for (const cat of nextCategories) {
        const bSet = brandsForCategory.get(cat.toLowerCase());
        if (bSet) bSet.forEach((b) => validBrands.add(b));
      }
      setBrands(brands.filter((b) => validBrands.has(b.toLowerCase())));
    }
  }

  function handleBrandChange(nextBrands: string[]) {
    setBrands(nextBrands);
    // Prune categories no longer valid for the newly selected brands
    if (nextBrands.length > 0 && categories.length > 0) {
      const validCategories = new Set<string>();
      for (const br of nextBrands) {
        const cSet = categoriesForBrand.get(br.toLowerCase());
        if (cSet) cSet.forEach((c) => validCategories.add(c));
      }
      setCategories(categories.filter((c) => validCategories.has(c.toLowerCase())));
    }
  }

  return (
    <form method="GET" className="panel flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-end gap-3">
        {/* Preserve top-bar search state when applying filters */}
        {q ? <input type="hidden" name="q" value={q} /> : null}

        {/* Multi-Select Category */}
        <MultiSelectDropdown
          label="Category"
          name="category"
          options={categoryOptions}
          selected={categories}
          onChange={handleCategoryChange}
          allowedKeys={allowedCategoryKeys}
          loading={categoriesLoading}
          placeholder="All Categories"
        />

        {/* Multi-Select Brand */}
        <MultiSelectDropdown
          label="Brand"
          name="brand"
          options={brandOptions}
          selected={brands}
          onChange={handleBrandChange}
          allowedKeys={allowedBrandKeys}
          loading={brandsLoading}
          placeholder="All Brands"
        />

        {/* Price range */}
        <div className="min-w-[100px]">
          <label className="mb-1 block text-[11px] font-medium text-slate-500">Min Price (₹/MT)</label>
          <input
            type="number"
            name="minPrice"
            defaultValue={minPrice}
            placeholder="Min"
            className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[color:var(--posh-primary)]"
          />
        </div>
        <div className="min-w-[100px]">
          <label className="mb-1 block text-[11px] font-medium text-slate-500">Max Price (₹/MT)</label>
          <input
            type="number"
            name="maxPrice"
            defaultValue={maxPrice}
            placeholder="Max"
            className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[color:var(--posh-primary)]"
          />
        </div>

        {/* Sort */}
        <div className="min-w-[140px]">
          <label className="mb-1 block text-[11px] font-medium text-slate-500">Sort</label>
          <select
            name="sort"
            defaultValue={sort}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[color:var(--posh-primary)]"
          >
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="newest">Newest</option>
          </select>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button type="submit" className="posh-btn-solid rounded-lg px-4 py-2 text-xs font-medium">
            Apply Filters
          </button>
          <a href="/products" className="whitespace-nowrap px-2 py-2 text-xs text-slate-400 hover:text-slate-600">
            Clear all
          </a>
        </div>
      </div>

      {/* Active filter badges */}
      {(categories.length > 0 || brands.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1">Active:</span>
          {categories.map((c) => (
            <span
              key={`cat-${c}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(var(--posh-wash-rgb),0.12)] px-2.5 py-0.5 text-[11px] font-medium text-[color:var(--posh-primary)] border border-[color:var(--posh-border)]"
            >
              <span>Category: {c}</span>
              <button
                type="button"
                onClick={() => setCategories(categories.filter((cat) => cat !== c))}
                className="hover:text-slate-900 transition-colors"
                aria-label={`Remove ${c} category filter`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          {brands.map((b) => (
            <span
              key={`brand-${b}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-800 border border-slate-200"
            >
              <span>Brand: {b}</span>
              <button
                type="button"
                onClick={() => setBrands(brands.filter((br) => br !== b))}
                className="hover:text-slate-900 transition-colors"
                aria-label={`Remove ${b} brand filter`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </form>
  );
}
