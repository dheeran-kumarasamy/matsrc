"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Fetched via this app's own internal proxy route (direct-Prisma
// implementation, see apps/web/app/api/proxy/public/catalog/[entity]/route.ts)
// rather than NEXT_PUBLIC_API_URL (defaults to unreachable localhost:4000 in
// production), which previously caused this fetch to fail with
// net::ERR_CONNECTION_REFUSED and the category grid to silently render empty.
const CATALOG_API_BASE_URL = "/api/proxy/public/catalog";

type CatalogCategory = {
  id: string;
  name: string;
  code?: string | null;
  // P2-B (Category Discovery imagery) — additive/optional so this type still
  // matches whatever the catalog endpoint returns for brand/grade/unit
  // entities that don't have these fields.
  imageUrl?: string | null;
  activeListingCount?: number;
};


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
// filter dropdown sends.
//
// Design update: icons and per-category imagery/listing counts have been
// removed from this grid entirely — each tile now shows only the category
// name, sized as tightly as possible around its text (no fixed card
// dimensions). Charcoal at rest, inverting to olive green on hover/focus
// via the shared .posh-category-tile utility (see globals.css).
function CategoryCard({ name }: { name: string }) {
  return (
    <Link
      href={`/products?category=${encodeURIComponent(name)}`}
      className="posh-category-tile inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-center text-sm font-medium md:text-lg"
    >
      {name}
    </Link>
  );
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
    /* Bottom padding reduced (was pb-16/20 — the main source of the large
       gap before "Why BuildOHub" below) so the two sections flow into each
       other with only enough space to stay visually distinct. */
    <section
      className="pb-8 pt-6 md:pb-10 md:pt-8"
      style={{ background: "var(--posh-bg)" }}
    >
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        {/* Heading-to-tiles gap reduced (mb-10 → mb-6) — was adding extra
            blank space inside this section beyond what's needed for visual
            separation from the category tiles below. */}
        <h2
          className="posh-heading mb-6 text-center text-2xl md:text-3xl"
          style={{ color: "var(--posh-fg)" }}
        >
          Shop by Category
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {loading
            ? Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="h-9 w-24 animate-pulse rounded-lg"
                  style={{ background: "var(--posh-border)" }}
                />
              ))
            : categories.map(({ id, name }) => <CategoryCard key={id} name={name} />)}
        </div>
      </div>
    </section>
  );
}
