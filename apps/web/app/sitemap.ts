import type { MetadataRoute } from "next";
import { getSupplierListings, dedupeByCanonicalGroup } from "@/lib/listings";
import { getSiteUrl } from "@/lib/site-url";
import { prisma } from "@/lib/prisma";

// P2-D — App Router sitemap convention. Covers ONLY genuinely public,
// indexable routes: homepage, catalogue root, real category-filtered
// catalogue pages (backed by the same active-category query P1/P2-B use —
// see app/api/proxy/public/catalog/[entity]/route.ts), and real active
// product detail pages. Never includes any P0-protected prefix
// (lib/route-guards.ts's PROTECTED_PREFIXES) or the price report route.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();

  const [categories, listings] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true, products: { some: { isActive: true } } },
      select: { name: true },
    }),
    getSupplierListings(),
  ]);

  const activeProducts = dedupeByCanonicalGroup(listings.filter((l) => l.active));

  const staticEntries: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/products`, changeFrequency: "daily", priority: 0.9 },
  ];

  const categoryEntries: MetadataRoute.Sitemap = categories.map((c) => ({
    url: `${siteUrl}/products?category=${encodeURIComponent(c.name)}`,
    changeFrequency: "daily",
    priority: 0.7,
  }));

  const productEntries: MetadataRoute.Sitemap = activeProducts.map((p) => ({
    url: `${siteUrl}/products/${p.id}`,
    changeFrequency: "daily",
    priority: 0.6,
  }));

  return [...staticEntries, ...categoryEntries, ...productEntries];
}
