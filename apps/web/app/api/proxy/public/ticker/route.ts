import { getSupplierListings, dedupeByCanonicalGroup, parseListingPrice } from "@/lib/listings";

export const dynamic = "force-dynamic";

const NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate";

// P0 fix (Phase 9): the homepage's "live price ticker" previously rendered a
// fully hardcoded array of 10 fake material names/prices/% changes
// (components/home/PriceTicker.tsx) — none of it backed by real data. This
// route exposes real, currently-active listing prices (the same source of
// truth the /products catalogue uses, via getSupplierListings()) so the
// ticker shows truthful "From ₹…" prices instead. There is no day-over-day
// price history feed wired into this app, so no `change`/`% today` figure is
// fabricated here — the ticker intentionally omits that field now.
export async function GET() {
  try {
    const listings = await getSupplierListings();
    const active = dedupeByCanonicalGroup(listings.filter((listing) => listing.active));

    const items = active
      .slice(0, 10)
      .map((listing) => ({
        name: listing.name,
        price: parseListingPrice(listing.price),
      }));

    return Response.json(items, { headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } });
  } catch (error) {
    console.error("Failed to fetch public ticker listings:", error);
    return Response.json([], {
      status: 200,
      headers: { "Cache-Control": NO_STORE_CACHE_CONTROL },
    });
  }
}
