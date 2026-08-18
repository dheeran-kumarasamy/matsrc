import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PriceReportView from "@/components/reports/PriceReportView";
import Breadcrumbs from "@/components/products/Breadcrumbs";
import { productReportBreadcrumbs } from "@/lib/breadcrumbs";
import { buildBreadcrumbJsonLd } from "@/lib/json-ld";
import { getSupplierListings, type SupplierListing } from "@/lib/listings";

export const dynamic = "force-dynamic";

// P2-D — this route is authenticated/protected (middleware.ts redirects
// unauthenticated visitors to login), and it surfaces the platform's price
// intelligence — not content we want search engines to index/crawl, even
// though a crawler would typically be redirected to login anyway. Explicit
// noindex here is defense-in-depth, matching the requirement that protected
// price-intelligence routes are never exposed to search engines merely to
// improve SEO.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Resolves the requested slug to the actual listing (and its canonical
// cross-supplier group id) the same way the PDP page does, so the report
// page can be reached from a per-listing slug URL. Only reads listings —
// does NOT touch the public listings route's caching behavior.
function resolveListing(allListings: SupplierListing[], slug: string): SupplierListing | null {
  return allListings.find((listing) => listing.id === slug) ?? null;
}

export default async function PriceReportPage({ params }: { params: { slug: string } }) {
  const allListings = await getSupplierListings();
  const listing = resolveListing(allListings, params.slug);
  const canonicalProductId = listing?.canonicalProductId || null;

  if (!canonicalProductId) {
    notFound();
  }

  // P2-C fix: this breadcrumb previously showed the literal placeholder text
  // "Product" instead of the actual product/category name — real data was
  // already available via the same listings lookup used above, it just
  // wasn't being used for the breadcrumb. Reuses productReportBreadcrumbs()
  // (lib/breadcrumbs.ts), the single source of truth also used by the PDP's
  // own breadcrumb and by BreadcrumbList JSON-LD.
  const breadcrumbItems = productReportBreadcrumbs({
    categoryName: listing?.category ?? null,
    productName: listing?.name ?? "Product",
    productSlug: params.slug,
  });

  return (
    <div className="space-y-4">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbJsonLd(breadcrumbItems)) }}
      />
      <Breadcrumbs items={breadcrumbItems} />

      <PriceReportView canonicalProductId={canonicalProductId as string} />
    </div>
  );
}
