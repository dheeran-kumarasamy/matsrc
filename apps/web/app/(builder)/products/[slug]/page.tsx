import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import EnquiryPanel from "@/components/products/EnquiryPanel";
import SupplierSocialProof from "@/components/products/SupplierSocialProof";
import WatchlistButton from "@/components/products/WatchlistButton";
import PriceIntelligenceSection from "@/components/products/PriceIntelligenceSection";
import DistrictPriceIntelligencePanel from "@/components/products/district-pricing/DistrictPriceIntelligencePanel";
import Breadcrumbs from "@/components/products/Breadcrumbs";
import { productBreadcrumbs } from "@/lib/breadcrumbs";
import { buildBreadcrumbJsonLd, buildProductJsonLd } from "@/lib/json-ld";
import { getSiteUrl } from "@/lib/site-url";

import { getCategoryEmoji } from "@/lib/category-images";

import { getSupplierListings, getSupplierProduct, parseNumericLabel, type SupplierListing } from "@/lib/listings";

export const dynamic = "force-dynamic";

// P2-D — unique per-product metadata using only real name/brand/category
// (no generic duplicated title across products). Canonical points at this
// product's own slug URL.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const product = await getSupplierProduct(params.slug);
  if (!product) return {};

  // P2-D fix: Product.name in this catalogue already includes the brand
  // (e.g. "UltraTech Cement OPC 53 Grade Cement"), so prepending
  // product.brand again produced a visibly duplicated title
  // ("UltraTech Cement UltraTech Cement OPC 53 Grade Cement"). Only prepend
  // the brand when the name doesn't already start with it.
  const title =
    product.brand && !product.name.toLowerCase().startsWith(product.brand.toLowerCase())
      ? `${product.brand} ${product.name}`
      : product.name;
  const description = `${title} — compare live prices from verified suppliers${
    product.category ? ` in ${product.category}` : ""
  } on Buildohub.`;

  return {
    title,
    description,
    alternates: { canonical: `${getSiteUrl()}/products/${params.slug}` },
  };
}

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

  const breadcrumbItems = productBreadcrumbs({ categoryName: product.category ?? null, productName: product.name });
  // P2-D — Product JSON-LD from only genuinely available fields (name,
  // brand, category, image, sku=Product.id). Deliberately no `offers` (the
  // price is quantity-tier/location/supplier dependent, never a single
  // universally-purchasable price) and no `aggregateRating` (no real
  // persisted product review/rating data exists anywhere in this schema —
  // see P0's fabricated-★4.6 finding).
  const productJsonLd = buildProductJsonLd({
    name: product.name,
    image: imageUrl,
    brand: product.brand ?? null,
    category: product.category ?? null,
    sku: product.id,
  });

  return (
    <div className="posh-body space-y-6">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbJsonLd(breadcrumbItems)) }}
      />
      <Breadcrumbs items={breadcrumbItems} />

      <div className="grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
        <section className="space-y-5">
          <div className="posh-card overflow-hidden p-0">
            <div className="flex h-56 w-full items-center justify-center overflow-hidden bg-[rgba(240,232,216,0.04)]">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-7xl" role="img" aria-label={product.category || "Product"}>
                  {getCategoryEmoji(product.category)}
                </span>
              )}
            </div>

            <div className="bg-[color:var(--posh-bg-card)] p-6">
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

            {/* P1 polish (Product Decision Experience): "Stock" and "Maximum
                serviceable" are two genuinely distinct supplier-entered
                fields (on-hand inventory vs. the largest single order the
                supplier says they can fulfil), but rendered with identical
                unlabelled numbers they read as duplicated/uninformative.
                Added a one-line explanation under each so a builder can
                actually use the distinction when deciding how much to
                enquire for — no new data introduced. */}
            <div className="grid gap-4 border-t border-[color:var(--posh-border)] p-6 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="posh-label">Base price</p>
                <p className="posh-card-title mt-1">{product.price}</p>
                <p className="posh-muted mt-1 text-xs">Per {product.unit}, before quantity-tier discounts.</p>
              </div>
              <div>
                <p className="posh-label">Stock</p>
                <p className="posh-card-title mt-1">{product.stock}</p>
                <p className="posh-muted mt-1 text-xs">Units the supplier currently holds on hand.</p>
              </div>
              <div>
                <p className="posh-label">Maximum serviceable</p>
                <p className="posh-card-title mt-1">{product.maxServiceableQty}</p>
                <p className="posh-muted mt-1 text-xs">Largest single order this supplier says they can fulfil.</p>
              </div>
            </div>
          </div>

          <div className="posh-card p-6">
            <h2 className="posh-card-title">Pricing tiers</h2>
            <p className="posh-subtitle mt-1">The enquiry value updates automatically as quantity changes.</p>
            <div className="mt-4 grid gap-3">
              {product.pricingTiers.map((tier) => (
                <div key={`${tier.minQty}-${tier.maxQty}`} className="flex items-center justify-between rounded-xl border border-[color:var(--posh-border)] bg-[rgba(240,232,216,0.03)] px-4 py-3 text-sm">
                  <div>
                    <p className="font-bold text-[color:var(--posh-fg)]">
                      {tier.minQty} - {tier.maxQty} {product.unit}
                    </p>
                    <p className="posh-label mt-1">Applicable quantity band</p>
                  </div>
                  <p className="font-bold text-[color:var(--posh-fg)]">₹{parseNumericLabel(tier.price).toLocaleString("en-IN")}</p>
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
