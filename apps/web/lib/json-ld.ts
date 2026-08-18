// json-ld.ts — P2-D (SEO metadata / structured data).
//
// Pure functions that build valid schema.org JSON-LD objects from real data
// only. Explicitly excludes:
//   - `offers` — the report/PDP price is quantity-tier, location, and
//     supplier dependent (never a single universally-purchasable price), so
//     representing it as a schema.org Offer would misrepresent it.
//   - `aggregateRating` / review data — P0 found the platform's ratings were
//     previously fabricated (hardcoded ★4.6); no real persisted
//     product-level review/rating data exists anywhere in this schema, so
//     this is never added here. (Supplier-level delivery/quality ratings do
//     exist — see SupplierSocialProof — but those are not the *product's*
//     aggregateRating and are out of scope for Product JSON-LD.)
//
// BreadcrumbList JSON-LD is generated from the exact same
// lib/breadcrumbs.ts hierarchy the UI's <Breadcrumbs> component renders —
// never a second hardcoded hierarchy (P2-C's own requirement, reused here).

import type { Breadcrumb } from "./breadcrumbs";
import { getSiteUrl } from "./site-url";

export type ProductJsonLdInput = {
  name: string;
  description?: string | null;
  image?: string | null;
  brand?: string | null;
  category?: string | null;
  /** Product.id — used as the schema.org `sku` (a real internal identifier, not a fabricated one). */
  sku: string;
};

/**
 * Builds a schema.org Product JSON-LD object from genuinely available
 * fields only. Every field here maps 1:1 to real product data — nothing is
 * invented to "fill out" the schema.
 */
export function buildProductJsonLd(input: ProductJsonLdInput) {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    sku: input.sku,
  };

  if (input.description) jsonLd.description = input.description;
  if (input.image) jsonLd.image = input.image;
  if (input.brand) jsonLd.brand = { "@type": "Brand", name: input.brand };
  if (input.category) jsonLd.category = input.category;

  return jsonLd;
}

/**
 * Builds a schema.org BreadcrumbList from the same Breadcrumb[] hierarchy
 * lib/breadcrumbs.ts produces and <Breadcrumbs> renders. Only linked crumbs
 * get an absolute `item` URL (schema.org requires one for non-terminal
 * items); the current/terminal crumb (href: null) is still listed by
 * position but without an item URL, matching how it's rendered as
 * non-clickable in the UI.
 */
export function buildBreadcrumbJsonLd(items: Breadcrumb[]) {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      ...(item.href ? { item: `${siteUrl}${item.href}` } : {}),
    })),
  };
}
