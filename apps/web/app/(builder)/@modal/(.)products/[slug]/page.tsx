import { notFound } from "next/navigation";
import { getSupplierListings } from "@/lib/listings";
import ProductQuickView from "@/components/products/ProductQuickView";

export const dynamic = "force-dynamic";

// Given the requested listing (by slug/id), resolve the full cross-supplier
// canonical group it belongs to so the quick-view overlay shows the group's
// lowest (headline) price — mirrors the same resolution logic used by the
// standalone PDP (app/(builder)/products/[slug]/page.tsx) to satisfy the
// "identical data across full page and overlay" requirement (spec 5A).
function resolveProductGroup(allListings: Awaited<ReturnType<typeof getSupplierListings>>, slug: string) {
  const requested = allListings.find((listing) => listing.id === slug);
  if (!requested) return null;

  const groupedIds = requested.groupedListingIds && requested.groupedListingIds.length > 0
    ? requested.groupedListingIds
    : [requested.id];

  const siblings = allListings.filter((listing) => groupedIds.includes(listing.id));

  const headline = requested.headlineSupplierId
    ? siblings.find((listing) => listing.supplierId === requested.headlineSupplierId) ?? requested
    : requested;

  return {
    ...headline,
    price: requested.headlinePrice || headline.price,
    groupedListingIds: groupedIds,
  };
}

// Intercepting route (Next.js "(.)" convention): when the user navigates to
// /products/[slug] FROM somewhere already inside the (builder) route group
// (e.g. clicking a ProductCard on /products), Next.js renders THIS page into
// the @modal parallel slot instead of the real page — so the PLP underneath
// never unmounts. Direct load / refresh / shared link bypasses interception
// entirely and renders the full standalone page at
// app/(builder)/products/[slug]/page.tsx. This is the crux of the spec 5A
// single-page overlay ordering architecture.
export default async function ProductQuickViewRoute({ params }: { params: { slug: string } }) {
  const allListings = await getSupplierListings();
  const product = resolveProductGroup(allListings, params.slug);
  if (!product) notFound();

  return <ProductQuickView product={product} />;
}
