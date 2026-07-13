// Shared fetch/parsing helpers for supplier listings, used by:
// - the full PLP page (app/(builder)/products/page.tsx)
// - the full standalone PDP page (app/(builder)/products/[slug]/page.tsx)
// - the intercepted quick-view overlay (app/(builder)/@modal/(.)products/[slug]/page.tsx)
//
// Centralizing this avoids drift between the "full page" and "overlay" render
// paths, which must show identical data per spec section 5A.

const SUPPLIER_APP_URL = process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";

export type PricingTier = {
  minQty: string;
  maxQty: string;
  price: string;
};

export type SupplierListing = {
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
  images?: string[];
};

export async function getSupplierListings(): Promise<SupplierListing[]> {
  try {
    // CRITICAL CACHING RULE: no-store so newly active SKUs show immediately.
    const response = await fetch(`${SUPPLIER_APP_URL}/api/public/listings`, {
      cache: "no-store",
      redirect: "manual",
    });

    if (!response.ok) return [];

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return [];

    return response.json() as Promise<SupplierListing[]>;
  } catch {
    return [];
  }
}

export async function getSupplierProduct(slug: string): Promise<SupplierListing | null> {
  const listings = await getSupplierListings();
  return listings.find((listing) => listing.id === slug) ?? null;
}

export function parseNumericLabel(value: string) {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function parseListingPrice(value: string) {
  return parseNumericLabel(value);
}
