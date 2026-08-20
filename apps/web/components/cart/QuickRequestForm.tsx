"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { MessageSquarePlus, X } from "lucide-react";
import { builderApiPost } from "@/lib/api";

interface Props { floating?: boolean }

type QuickRequestResponse =
  | { matched: true; stage: string; orders: { id: string; supplierName: string; total: number; itemCount: number }[] }
  | { matched: false; message: string };

type CatalogOption = { id: string; name: string; code?: string | null };

// Minimal active-listing shape used to populate/cascade the Category ->
// Brand -> Product dropdowns and to derive the selected product's unit.
// Sourced from apps/web/app/api/proxy/public/listings/route.ts, which wraps
// the existing getSupplierListings() helper (same no-store data every other
// listing-driven surface in this app uses).
type QuickRequestListing = {
  id: string;
  name: string;
  category: string;
  brand: string;
  unit: string;
  grade: string;
};

function useCatalogOptions(entity: "category" | "brand") {
  const [options, setOptions] = useState<CatalogOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const response = await fetch(`/api/proxy/public/catalog/${entity}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Failed to load ${entity} options`);
        const data = (await response.json()) as CatalogOption[];
        if (!cancelled) setOptions(data);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [entity]);

  return { options, loading };
}

function useActiveListings() {
  const [listings, setListings] = useState<QuickRequestListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const response = await fetch("/api/proxy/public/listings", { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to load listings");
        const data = (await response.json()) as QuickRequestListing[];
        if (!cancelled) setListings(data);
      } catch {
        if (!cancelled) setListings([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { listings, loading };
}

// FR-32: Quick Material Request Form — always available, < 30 seconds.
// Submits a real nearest-match enquiry via /api/builder/quick-request, which
// reuses the same cart/checkout enquiry pipeline (UF-03) so resulting
// enquiries show up identically in /orders.
//
// Category/Brand/Product are now selected from admin-configured master data
// dropdowns (same pattern as ProductFilters.tsx) instead of free text, so
// builders can only pick a real, active listing. Quantity remains free text;
// the unit shown next to it is derived from the selected Product, not
// user-editable. Pincode remains free text.
export default function QuickRequestForm({ floating }: Props) {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [open, setOpen] = useState(false);

  const { options: categoryOptions, loading: categoriesLoading } = useCatalogOptions("category");
  const { options: brandOptions, loading: brandsLoading } = useCatalogOptions("brand");
  const { listings, loading: listingsLoading } = useActiveListings();

  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [pincode, setPincode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [noMatchMessage, setNoMatchMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Brands that actually have an active listing in the selected category
  // (mirrors ProductFilters.tsx's bidirectional category<->brand narrowing).
  const brandsForSelectedCategory = useMemo(() => {
    if (!category) return null;
    const set = new Set<string>();
    for (const listing of listings) {
      if (listing.category.toLowerCase() === category.toLowerCase() && listing.brand) {
        set.add(listing.brand.toLowerCase());
      }
    }
    return set;
  }, [listings, category]);

  // Products matching the selected Category + Brand.
  const productOptions = useMemo(() => {
    return listings.filter((listing) => {
      if (category && listing.category.toLowerCase() !== category.toLowerCase()) return false;
      if (brand && (listing.brand ?? "").toLowerCase() !== brand.toLowerCase()) return false;
      return true;
    });
  }, [listings, category, brand]);

  const selectedProduct = useMemo(
    () => listings.find((listing) => listing.id === productId) ?? null,
    [listings, productId]
  );

  function handleCategoryChange(nextCategory: string) {
    setCategory(nextCategory);
    setProductId("");
    if (nextCategory && brand) {
      const validBrands = new Set<string>();
      for (const listing of listings) {
        if (listing.category.toLowerCase() === nextCategory.toLowerCase() && listing.brand) {
          validBrands.add(listing.brand.toLowerCase());
        }
      }
      if (!validBrands.has(brand.toLowerCase())) setBrand("");
    }
  }

  function handleBrandChange(nextBrand: string) {
    setBrand(nextBrand);
    setProductId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (sessionStatus !== "authenticated") {
      router.push(`/auth/login?callbackUrl=${encodeURIComponent("/")}`);
      return;
    }

    if (!productId || !quantity || !pincode) {
      setError("Select a category, brand and product, and fill in quantity and pincode.");
      return;
    }

    setLoading(true);
    setError(null);
    setNoMatchMessage(null);

    try {
      const response = await builderApiPost<QuickRequestResponse>("/quick-request", {
        productId,
        quantity,
        pincode,
      });

      if (response.matched) {
        setSubmitted(true);
      } else {
        setNoMatchMessage(response.message);
      }
    } catch {
      setError("Unable to submit your request right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setOpen(false);
    setSubmitted(false);
    setNoMatchMessage(null);
    setError(null);
    setCategory("");
    setBrand("");
    setProductId("");
    setQuantity("");
    setPincode("");
  }

  if (floating) {
    return (
      <>
        <button onClick={() => setOpen(true)} className="fixed bottom-6 right-6 z-40 flex min-h-[44px] items-center gap-2 rounded-full bg-accent-500 px-5 py-3 text-sm font-medium text-[color:var(--posh-primary-fg)] shadow-lg transition-colors hover:bg-accent-600">
          <MessageSquarePlus size={18} />
          <span className="hidden sm:inline">Quick Request</span>
        </button>
        {open && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[rgba(240,232,216,0.16)] p-4">
            <div className="bg-[color:var(--posh-bg-card)] rounded-2xl shadow-xl w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-800">Quick Material Request</h3>
                <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
              </div>
              {submitted ? (
                <div className="text-center py-6">
                  <div className="text-4xl mb-2">✅</div>
                  <p className="font-medium text-slate-800">Request Submitted!</p>
                  <p className="text-sm text-slate-400 mt-1">Suppliers will respond with quotes shortly.</p>
                  <button onClick={() => router.push("/orders")} className="mt-4 block w-full text-xs text-[color:var(--posh-primary)] hover:underline">View my orders</button>
                  <button onClick={reset} className="mt-2 text-xs text-slate-400 hover:underline">Submit another</button>
                </div>
              ) : noMatchMessage ? (
                <div className="text-center py-6">
                  <div className="text-4xl mb-2">🔍</div>
                  <p className="font-medium text-slate-800">No close match found</p>
                  <p className="text-sm text-slate-400 mt-1">{noMatchMessage}</p>
                  <button onClick={() => { setOpen(false); router.push("/products"); }} className="mt-4 block w-full text-xs text-[color:var(--posh-primary)] hover:underline">Browse categories</button>
                  <button onClick={() => setNoMatchMessage(null)} className="mt-2 text-xs text-slate-400 hover:underline">Try again</button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-3">
                  {/* Category */}
                  <select
                    required
                    value={category}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    disabled={categoriesLoading}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[color:var(--posh-primary)]"
                  >
                    <option value="">Select category</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>

                  {/* Brand */}
                  <select
                    required
                    value={brand}
                    onChange={(e) => handleBrandChange(e.target.value)}
                    disabled={brandsLoading}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[color:var(--posh-primary)]"
                  >
                    <option value="">Select brand</option>
                    {brandOptions.map((b) => {
                      const disabled = brandsForSelectedCategory ? !brandsForSelectedCategory.has(b.name.toLowerCase()) : false;
                      return (
                        <option key={b.id} value={b.name} disabled={disabled}>{b.name}</option>
                      );
                    })}
                  </select>

                  {/* Product */}
                  <select
                    required
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    disabled={listingsLoading}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[color:var(--posh-primary)]"
                  >
                    <option value="">Select product</option>
                    {productOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>

                  {/* Quantity (free text) + derived unit */}
                  <div className="flex gap-2">
                    <input
                      required
                      inputMode="numeric"
                      placeholder="Quantity"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[color:var(--posh-primary)]"
                    />
                    <div className="flex items-center justify-center min-w-[64px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
                      {selectedProduct?.unit || "Unit"}
                    </div>
                  </div>

                  {/* Pincode (free text) */}
                  <input required placeholder="Delivery pincode" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[color:var(--posh-primary)]" />

                  {error && <p className="text-xs text-red-600">{error}</p>}
                  <button type="submit" disabled={loading} className="w-full bg-accent-500 hover:bg-accent-600 text-[color:var(--posh-primary-fg)] rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
                    {loading ? "Submitting..." : "Get Quotes from Suppliers"}
                  </button>
                  <p className="text-xs text-slate-400 text-center">Takes less than 30 seconds</p>
                </form>
              )}
            </div>
          </div>
        )}
      </>
    );
  }
  return null;
}
