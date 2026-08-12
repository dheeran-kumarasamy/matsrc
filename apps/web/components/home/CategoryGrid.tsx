"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Fetched via this app's own internal proxy route (direct-Prisma
// implementation, see apps/web/app/api/proxy/public/catalog/[entity]/route.ts)
// rather than NEXT_PUBLIC_API_URL (defaults to unreachable localhost:4000 in
// production), which previously caused this fetch to fail with
// net::ERR_CONNECTION_REFUSED and the category grid to silently render empty.
const CATALOG_API_BASE_URL = "/api/proxy/public/catalog";

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
        const response = await fetch(`${CATALOG_API_BASE_URL}/category`, { cache: "no-store" });

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
    <section
      className="py-16 md:py-20"
      style={{ background: "var(--posh-bg)" }}
    >
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <h2
          className="posh-heading mb-10 text-2xl md:text-3xl"
          style={{ color: "var(--posh-fg)" }}
        >
          Shop by Category
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {loading
            ? Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="flex min-h-[80px] animate-pulse flex-col items-center justify-center rounded-2xl p-5"
                  style={{ background: "var(--posh-bg-card)" }}
                >
                  <div className="mb-2 h-8 w-8 rounded-full" style={{ background: "var(--posh-border)" }} />
                  <div className="h-3 w-16 rounded" style={{ background: "var(--posh-border)" }} />
                </div>
              ))
            : categories.map(({ id, name }) => (
                <Link
                  key={id}
                  href={`/products?category=${encodeURIComponent(name)}`}
                  className="flex min-h-[80px] flex-col items-center justify-center rounded-2xl border p-5 text-center transition-all duration-200"
                  style={{
                    background: "var(--posh-bg-card)",
                    borderColor: "var(--posh-border)",
                    color: "var(--posh-fg-muted)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--posh-primary)";
                    (e.currentTarget as HTMLElement).style.color = "var(--posh-fg)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--posh-border)";
                    (e.currentTarget as HTMLElement).style.color = "var(--posh-fg-muted)";
                  }}
                >
                  <div className="text-3xl mb-2">{iconForCategory(name)}</div>
                  <div className="text-sm font-medium leading-tight">{name}</div>
                </Link>
              ))}
        </div>
      </div>
    </section>
  );
}
