// `get_current_prices` — price + freight resolution for the sourcing assistant.
//
// PRICE PRECEDENCE (highest confidence first):
//   1. The supplier's own live listing price, tier-resolved for the requested
//      quantity. This is the number the cart/checkout would actually charge, so
//      it is the only price we ever attribute to a specific supplier.
//   2. PriceSnapshot — the platform's append-only price time series, used for a
//      recency/context signal, never to overwrite (1).
//   3. AGNI / Price Intelligence (PricingObservation -> PricingDistrictPriceDaily,
//      served by apps/api's `public/pricing/resolve` with DISTRICT > STATE >
//      NATIONAL fallback). Used as MARKET CONTEXT only.
//
// AGNI INTEGRATION RULE (§22): the AGNI work is treated as a parallel data
// source, and it is explicitly NOT a blocker. A market reference price is never
// presented as a supplier's quote, and if the pricing service is unreachable or
// returns NO_DATA the assistant proceeds on platform data alone. That is why
// this module fails soft in every path.
//
// FREIGHT (§7): there is no per-route freight table in this schema. The only
// real freight data available is:
//   - PricePoint.freight, recorded per (product, sourceCity)
//   - PRICING_FREIGHT_RATE_PER_KM_PER_BASE_UNIT, the AGNI derivation env var
// When neither yields a value for a route, freight is returned as null and the
// landed-cost calculator records a "freight" data gap. Freight is NEVER
// estimated with a made-up rate.

/** Market reference price from the AGNI/Price-Intelligence serving layer. */
export type MarketReferencePrice = {
  price: number;
  unit: string | null;
  geographyLevel: "DISTRICT" | "STATE" | "NATIONAL" | null;
  district: string | null;
  state: string | null;
  fallbackUsed: boolean;
  source: "AGNI_PRICE_INTELLIGENCE";
};

function apiBaseUrl(): string {
  // Same env convention as the rest of the app's server-to-server calls.
  return (
    process.env.BACKEND_API_URL ||
    (process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/api` : "http://localhost:4000/api")
  );
}

/**
 * Fetches a market reference price for a canonical SKU + district from the
 * existing public pricing endpoint.
 *
 * Fails SOFT: any error, non-200, NO_DATA response or missing configuration
 * yields null. The assistant then simply has no market context — which it
 * discloses rather than fabricating a figure.
 */
export async function getMarketReferencePrice(
  canonicalSkuCode: string,
  districtCode: string
): Promise<MarketReferencePrice | null> {
  if (!canonicalSkuCode || !districtCode) return null;

  try {
    const url = new URL(`${apiBaseUrl()}/public/pricing/resolve`);
    url.searchParams.set("canonicalSkuCode", canonicalSkuCode);
    url.searchParams.set("districtCode", districtCode);

    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      price?: number | null;
      unit?: string | null;
      geographyLevel?: string | null;
      district?: string | null;
      state?: string | null;
      fallbackUsed?: boolean;
    };

    if (typeof data.price !== "number" || !Number.isFinite(data.price)) return null;

    return {
      price: data.price,
      unit: data.unit ?? null,
      geographyLevel: (data.geographyLevel as MarketReferencePrice["geographyLevel"]) ?? null,
      district: data.district ?? null,
      state: data.state ?? null,
      fallbackUsed: Boolean(data.fallbackUsed),
      source: "AGNI_PRICE_INTELLIGENCE",
    };
  } catch (error) {
    // Never let a pricing-intelligence outage break a sourcing session (§22).
    console.warn(
      `[sourcing] market reference price unavailable for ${canonicalSkuCode}/${districtCode}:`,
      error instanceof Error ? error.message : "unknown error"
    );
    return null;
  }
}

/** A freight observation actually recorded in the platform. */
export type FreightObservation = {
  /** PricePoint.sourceCity, e.g. "EX-Raipur". */
  sourceCity: string;
  /** Total freight recorded for that lane. */
  freight: number;
  recordedAt: Date;
};

/**
 * Picks the freight figure to use for a product, given the freight observations
 * the platform actually holds.
 *
 * Selection: the most recent observation whose sourceCity matches the delivery
 * location, else the most recent observation for the product, else null.
 * Returning the product-level fallback is sound because PricePoint.freight is
 * real recorded data for that product; the caller discloses that it is an
 * estimate, and `matchedLocation` says whether the lane matched.
 */
export function resolveFreight(
  observations: FreightObservation[],
  location: string | null
): { freight: number | null; matchedLocation: boolean } {
  if (observations.length === 0) return { freight: null, matchedLocation: false };

  const sorted = [...observations].sort(
    (a, b) => b.recordedAt.getTime() - a.recordedAt.getTime()
  );

  const target = (location ?? "").trim().toLowerCase();
  if (target) {
    const laneMatch = sorted.find((observation) => {
      const city = observation.sourceCity.toLowerCase().replace(/^ex-/, "").trim();
      return city.includes(target) || target.includes(city);
    });
    if (laneMatch) {
      return { freight: laneMatch.freight, matchedLocation: true };
    }
  }

  return { freight: sorted[0].freight, matchedLocation: false };
}
