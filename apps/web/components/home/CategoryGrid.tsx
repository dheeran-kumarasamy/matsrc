"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

type CatalogCategory = { id: string; name: string; code?: string | null };

// BUG-05 fix: previously this grid used a hardcoded list of 8 categories
// with made-up slugs (e.g. "steel", "cement") that never matched any real
// `Category.name` in the database (the only two seeded categories are
// "Cement" and "TMT Bars"). Since the Browse Materials category filter
// matches against the real Category.name (see
// apps/web/app/(builder)/products/page.tsx), every tile except a lucky
// substring match returned zero results even though the same term typed
// into search worked fine (search matches free text across name/category/
// grade, not an exact category slug).
//
// Fix: fetch the actual admin-configured categories from the same
// `/public/catalog/category` endpoint ProductFilters.tsx already uses (the
// single source of truth for category master data), and link using the
// real `name` value as the `category` query param — the same value the
// filter dropdown sends. A small icon-by-name lookup preserves the visual
// design for known categories, falling back to a generic icon for any
// other admin-added category so the grid never visually breaks.
const ICONS_BY_NAME: Record<string, string> = {
  "steel": "🔩",
  "tmt bars": "🔩",
  "steel & tmt bars": "🔩",
  "cement": "🏗️",
  "bricks": "🧱",
  "bricks & blocks": "🧱",
  "sand & aggregates": "⛏️",
  "aggregates": "⛏️",
  "pipes & fittings": "🔧",
  "pipes": "🔧",
  "electrical": "⚡",
  "plywood & timber": "🪵",
  "plywood": "🪵",
  "paints & chemicals": "🎨",
  "paints": "🎨",
};

function iconForCategory(name: string) {
  return ICONS_BY_NAME[name.trim().toLowerCase()] ?? "🏢";
}

export default function CategoryGrid() {
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`${API_BASE_URL}/public/catalog/category`, { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to load categories");
        const data = (await response.json()) as CatalogCategory[];
        if (!cancelled) setCategories(data);
      } catch {
        if (!cancelled) setCategories([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loading && categories.length === 0) {
    return null;
  }

  return (
    <section className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 md:text-3xl">Shop by Category</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {loading
          ? Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="flex min-h-[44px] animate-pulse flex-col items-center justify-center rounded-xl border border-gray-100 bg-gray-50 p-4"
              >
                <div className="mb-2 h-8 w-8 rounded-full bg-gray-200" />
                <div className="h-3 w-16 rounded bg-gray-200" />
              </div>
            ))
          : categories.map(({ id, name }) => (
              <Link
                key={id}
                href={`/products?category=${encodeURIComponent(name)}`}
                className="flex min-h-[44px] flex-col items-center justify-center bg-white border border-gray-100 rounded-xl p-4 text-center hover:shadow-md hover:border-brand-500 transition-all"
              >
                <div className="text-3xl mb-2">{iconForCategory(name)}</div>
                <div className="text-sm font-medium text-gray-600 leading-tight">{name}</div>
              </Link>
            ))}
      </div>
    </section>
  );
}
