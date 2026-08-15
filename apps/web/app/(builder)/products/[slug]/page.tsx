import Link from "next/link";
import { notFound } from "next/navigation";
import EnquiryPanel from "@/components/products/EnquiryPanel";
import SupplierSocialProof from "@/components/products/SupplierSocialProof";
import WatchlistButton from "@/components/products/WatchlistButton";
import PriceIntelligenceSection from "@/components/products/PriceIntelligenceSection";
import DistrictPriceIntelligencePanel from "@/components/products/district-pricing/DistrictPriceIntelligencePanel";

import { getCategoryEmoji } from "@/lib/category-images";

import { getSupplierListings, parseNumericLabel, type SupplierListing } from "@/lib/listings";

export const dynamic = "force-dynamic";

// Given the requested listing (by slug/id), resolve the full cross-supplier
// canonical group it belongs to so the PDP can show the group's lowest
// (headline) price rather than just this one supplier's own price — fixes
// the Display bug from the cross-supplier price resolution spec. Falls back
// to the single listing itself when it has no canonicalProductId /
// groupedListingIds (legacy / ungrouped data).
function resolveProductGroup(allListings: SupplierListing[], slug: string) {
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
    displayListing: {
      ...headline,
      price: requested.headlinePrice || headline.price,
    },
    siblings,
  };
}

export default async function ProductDetailPage({ params }: { params: { slug: string } }) {
  const allListings = await getSupplierListings();
  const group = resolveProductGroup(allListings, params.slug);
  if (!group) notFound();

  const { displayListing: product, siblings } = group;

  const maxServiceableQty = parseNumericLabel(product.maxServiceableQty);
  const basePrice = parseNumericLabel(product.price);
  const imageUrl = product.images && product.images.length > 0 ? product.images[0] : null;

  const otherSuppliersCount = siblings.filter((listing) => listing.supplierId !== product.supplierId).length;

  return (
    <div className="posh-body space-y-6">
      <nav className="posh-label flex items-center gap-2">
        <Link href="/products" className="hover:text-black hover:underline">
          Materials
        </Link>
        <span>/</span>
        <span className="text-black">{product.name}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
        <section className="space-y-5">
          <div className="posh-card overflow-hidden p-0">
            <div className="flex h-56 w-full items-center justify-center overflow-hidden bg-black/[0.04]">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-7xl" role="img" aria-label={product.category || "Product"}>
                  {getCategoryEmoji(product.category)}
                </span>
              )}
            </div>

            <div className="bg-white p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="posh-eyebrow">Supplier Listing</p>
                  <h1 className="posh-page-title mt-2">{product.name}</h1>
                  <p className="posh-subtitle mt-2">
                    {product.category} · {product.grade} · {product.unit}
                  </p>
                </div>
                <span className="posh-status">Live enquiry pricing</span>
              </div>
              {otherSuppliersCount > 0 ? (
                <p className="posh-muted mt-3 text-xs">
                  Showing the lowest price across {otherSuppliersCount + 1} verified suppliers for this product.
                </p>
              ) : null}
            </div>

            <div className="grid gap-4 border-t border-black/10 p-6 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="posh-label">Base price</p>
                <p className="posh-card-title mt-1">{product.price}</p>
              </div>
              <div>
                <p className="posh-label">Stock</p>
                <p className="posh-card-title mt-1">{product.stock}</p>
              </div>
              <div>
                <p className="posh-label">Maximum serviceable</p>
                <p className="posh-card-title mt-1">{product.maxServiceableQty}</p>
              </div>
            </div>
          </div>

          <div className="posh-card p-6">
            <h2 className="posh-card-title">Pricing tiers</h2>
            <p className="posh-subtitle mt-1">The enquiry value updates automatically as quantity changes.</p>
            <div className="mt-4 grid gap-3">
              {product.pricingTiers.map((tier) => (
                <div key={`${tier.minQty}-${tier.maxQty}`} className="flex items-center justify-between rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm">
                  <div>
                    <p className="font-bold text-black">
                      {tier.minQty} - {tier.maxQty} {product.unit}
                    </p>
                    <p className="posh-label mt-1">Applicable quantity band</p>
                  </div>
                  <p className="font-bold text-black">₹{parseNumericLabel(tier.price).toLocaleString("en-IN")}</p>
                </div>
              ))}
            </div>
          </div>
          {product.canonicalProductId ? (
            <>
              <PriceIntelligenceSection canonicalProductId={product.canonicalProductId} />
              <DistrictPriceIntelligencePanel
                canonicalProductId={product.canonicalProductId}
                basePrice={basePrice}
              />
              <div className="posh-card flex flex-wrap items-center justify-between gap-4 p-6">
                <div>
                  <h2 className="posh-card-title">Price Desk</h2>
                  <p className="posh-subtitle mt-1">
                    Buy/Hold/Wait signal, forecast, landed cost across suppliers, and live market intelligence.
                  </p>
                </div>
                <Link href={`/products/${params.slug}/report`} className="posh-btn whitespace-nowrap">
                  Open Price Report
                </Link>
              </div>
            </>
          ) : null}

        </section>

        <aside className="space-y-4">

          <SupplierSocialProof listingId={product.id} supplierId={product.supplierId} showViewTracking />
          <EnquiryPanel
            productId={product.id}
            unit={product.unit}
            maxServiceableQty={Math.max(maxServiceableQty, 1)}
            pricingTiers={product.pricingTiers.length > 0 ? product.pricingTiers : [{ minQty: "1", maxQty: String(Math.max(maxServiceableQty, 1)), price: String(basePrice) }]}
          />
          <div className="posh-card p-6">
            <WatchlistButton productId={product.id} />
          </div>
        </aside>
      </div>
    </div>
  );
}
