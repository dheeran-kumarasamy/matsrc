import type { MetadataRoute } from "next";
import { PROTECTED_PREFIXES } from "@/lib/route-guards";
import { getSiteUrl } from "@/lib/site-url";

// P2-D — App Router robots.txt convention. Disallow rules are generated
// from the SAME protected-route list middleware.ts already enforces
// (lib/route-guards.ts's PROTECTED_PREFIXES) rather than a second hardcoded
// list, so this can never silently drift out of sync with what's actually
// authenticated. Also explicitly disallows the price-report route (public
// catalogue-adjacent but authenticated/noindex — see its own page-level
// `robots: {index:false}`) and auth routes (no reason to index a login/
// registration form).
export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        ...PROTECTED_PREFIXES.map((prefix) => `${prefix}/`),
        ...PROTECTED_PREFIXES,
        "/products/*/report",
        "/auth/",
        "/api/",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
