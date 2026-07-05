import Link from "next/link";
import { notFound } from "next/navigation";
import EnquiryPanel from "@/components/products/EnquiryPanel";
import SupplierSocialProof from "@/components/products/SupplierSocialProof";

export const dynamic = "force-dynamic";

const SUPPLIER_APP_URL = process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";

type PricingTier = {
  minQty: string;
  maxQty: string;
  price: string;
};

type SupplierListing = {
  id: string;
  supplierId: string;
  name: string;
  category: string;
  grade: string;
  unit: string;
  price: string;
  stock: string;
  maxServiceableQty: string;
  active: boolean;
  pricingTiers: PricingTier[];
};

async function getSupplierProduct(slug: string): Promise<SupplierListing | null> {
  try {
    const response = await fetch(`${SUPPLIER_APP_URL}/api/public/listings`, { cache: "no-store" });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;

    const listings = (await response.json()) as SupplierListing[];
    return listings.find((listing) => listing.id === slug) ?? null;
  } catch {
    return null;
  }
}

function parseNumericLabel(value: string) {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export default async function ProductDetailPage({ params }: { params: { slug: string } }) {
  const product = await getSupplierProduct(params.slug);
  if (!product) notFound();

  const maxServiceableQty = parseNumericLabel(product.maxServiceableQty);
  const basePrice = parseNumericLabel(product.price);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-xs text-slate-400">
        <Link href="/products" className="hover:text-blue-700">
          Materials
        </Link>
        <span>/</span>
        <span className="text-slate-600">{product.name}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
        <section className="space-y-5">
          <div className="panel overflow-hidden p-0">
            <div className="bg-gradient-to-br from-slate-50 to-white p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Supplier Listing</p>
                  <h1 className="text-3xl font-bold text-slate-900">{product.name}</h1>
                  <p className="text-sm text-slate-500">
                    {product.category} · {product.grade} · {product.unit}
                  </p>
                </div>
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Live enquiry pricing
                </div>
              </div>
            </div>

            <div className="grid gap-4 border-t border-slate-100 p-6 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs text-slate-400">Base price</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{product.price}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Stock</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{product.stock}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Maximum serviceable</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{product.maxServiceableQty}</p>
              </div>
            </div>
          </div>

          <div className="panel p-5">
            <h2 className="text-lg font-semibold text-slate-900">Pricing tiers</h2>
            <p className="mt-1 text-sm text-slate-500">The enquiry value updates automatically as quantity changes.</p>
            <div className="mt-4 grid gap-3">
              {product.pricingTiers.map((tier) => (
                <div key={`${tier.minQty}-${tier.maxQty}`} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-800">
                      {tier.minQty} - {tier.maxQty} {product.unit}
                    </p>
                    <p className="text-xs text-slate-400">Applicable quantity band</p>
                  </div>
                  <p className="font-semibold text-slate-900">₹{parseNumericLabel(tier.price).toLocaleString("en-IN")}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <SupplierSocialProof listingId={product.id} supplierId={product.supplierId} showViewTracking />
          <EnquiryPanel
            productId={product.id}
            unit={product.unit}
            maxServiceableQty={Math.max(maxServiceableQty, 1)}
            pricingTiers={product.pricingTiers.length > 0 ? product.pricingTiers : [{ minQty: "1", maxQty: String(Math.max(maxServiceableQty, 1)), price: String(basePrice) }]}
          />
        </aside>
      </div>
    </div>
  );
}
