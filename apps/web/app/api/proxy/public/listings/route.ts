import { getSupplierListings } from "@/lib/listings";

export const dynamic = "force-dynamic";

const NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate";

/**
 * Lightweight, browser-safe read of active supplier listings, used to power
 * the Quick Material Request form's Category -> Brand -> Product dropdowns
 * (apps/web/components/cart/QuickRequestForm.tsx). Reuses the existing
 * server-side `getSupplierListings()` helper (CRITICAL CACHING RULE:
 * no-store — see apps/web/lib/listings.ts) rather than duplicating the
 * upstream fetch, and only exposes the minimal fields the client needs.
 */
export async function GET() {
  try {
    const listings = await getSupplierListings();

    const active = listings
      .filter((listing) => listing.active)
      .map((listing) => ({
        id: listing.id,
        name: listing.name,
        category: listing.category,
        brand: listing.brand ?? "",
        unit: listing.unit,
        grade: listing.grade,
      }));

    return Response.json(active, { headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } });
  } catch (error) {
    console.error("Failed to fetch public listings for quick request:", error);
    return Response.json(
      { error: "Failed to fetch listings" },
      { status: 500, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
    );
  }
}
