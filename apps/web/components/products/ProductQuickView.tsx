"use client";

// Shared "quick view" content for a single product. Rendered inside:
// - the intercepted overlay route (app/(builder)/@modal/(.)products/[slug]/page.tsx)
// This is a client component so it can wire up the Dialog, cart store, and
// router.back()-based close behaviour required by the overlay architecture
// (spec section 5A).

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import EnquiryPanel from "@/components/products/EnquiryPanel";
import SupplierSocialProof from "@/components/products/SupplierSocialProof";
import { getDefaultCategoryImage } from "@/lib/category-images";
import { parseNumericLabel, type SupplierListing } from "@/lib/listings";

type Props = {
  product: SupplierListing;
};

export default function ProductQuickView({ product }: Props) {
  const router = useRouter();

  const maxServiceableQty = parseNumericLabel(product.maxServiceableQty);
  const basePrice = parseNumericLabel(product.price);
  const imageUrl = product.images && product.images.length > 0 ? product.images[0] : getDefaultCategoryImage(product.category);

  function handleOpenChange(open: boolean) {
    if (!open) {
      // Overlay close = go back to the PLP that never unmounted underneath.
      router.back();
    }
  }

  return (
    <Dialog defaultOpen onOpenChange={handleOpenChange}>
      <DialogContent className="p-0">
        <div className="grid gap-0 lg:grid-cols-[1.3fr_1fr]">
          <section className="max-h-[88vh] overflow-y-auto sm:max-h-[80vh]">
            <div className="h-48 w-full overflow-hidden bg-slate-100 sm:h-56">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" />
            </div>
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Quick View</p>
                  <h2 className="text-2xl font-bold text-slate-900">{product.name}</h2>
                  <p className="text-sm text-slate-500">
                    {product.category} · {product.grade} · {product.unit}
                  </p>
                </div>
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Live enquiry pricing
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Base price</p>
                  <p className="mt-1 font-semibold text-slate-900">{product.price}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Stock</p>
                  <p className="mt-1 font-semibold text-slate-900">{product.stock}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Max qty</p>
                  <p className="mt-1 font-semibold text-slate-900">{product.maxServiceableQty}</p>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">Pricing tiers</h3>
                <div className="grid gap-2">
                  {product.pricingTiers.slice(0, 3).map((tier) => (
                    <div
                      key={`${tier.minQty}-${tier.maxQty}`}
                      className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs"
                    >
                      <span className="text-slate-600">
                        {tier.minQty} - {tier.maxQty} {product.unit}
                      </span>
                      <span className="font-semibold text-slate-900">
                        ₹{parseNumericLabel(tier.price).toLocaleString("en-IN")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <Link href={`/products/${product.id}`} className="inline-block text-xs text-blue-700 hover:underline">
                View full product page →
              </Link>
            </div>
          </section>

          <aside className="space-y-4 border-t border-slate-100 p-5 lg:border-l lg:border-t-0">
            <SupplierSocialProof listingId={product.id} supplierId={product.supplierId} showViewTracking />
            <EnquiryPanel
              productId={product.id}
              unit={product.unit}
              maxServiceableQty={Math.max(maxServiceableQty, 1)}
              pricingTiers={product.pricingTiers.length > 0 ? product.pricingTiers : [{ minQty: "1", maxQty: String(Math.max(maxServiceableQty, 1)), price: String(basePrice) }]}
            />
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
