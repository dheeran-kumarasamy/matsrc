"use client";

import { useEffect, useState } from "react";
import { builderApiGet } from "@/lib/api";
import PriceChart from "@/components/products/PriceChart";
import PriceGrid from "@/components/products/PriceGrid";

type PriceComparisonOffer = {
  productId: string;
  name: string;
  brand: string | null;
  supplierId: string;
  supplierName: string;
  price: number;
  unit: string;
};

type PriceComparisonHistoryEntry = {
  id: string;
  price: number;
  source: string;
  region: string | null;
  recordedAt: string;
};

type PriceComparisonResponse = {
  canonicalProductId: string;
  title: string;
  offers: PriceComparisonOffer[];
  history: PriceComparisonHistoryEntry[];
};

// P0 price-discovery: wires the (previously orphaned) PriceChart/PriceGrid
// components to the real cross-supplier comparison endpoint
// (/api/builder/price-comparison/[canonicalProductId]). Only renders when
// the current product has been resolved into a canonical group — omitted
// entirely for legacy/ungrouped listings (no canonicalProductId).
export default function PriceIntelligenceSection({ canonicalProductId }: { canonicalProductId: string }) {
  const [data, setData] = useState<PriceComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    builderApiGet<PriceComparisonResponse>(`/price-comparison/${canonicalProductId}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canonicalProductId]);

  if (loading || error || !data) {
    return null;
  }

  // PriceGrid expects { brand, sourceCity, price }[]. No source-city
  // dimension exists on live offers in P0 (out of scope), so each active
  // supplier offer is surfaced as its own "column" keyed by supplier name —
  // gives builders a real cross-supplier price comparison without
  // fabricating city data.
  const gridRows = data.offers.map((offer) => ({
    brand: offer.brand || offer.name,
    sourceCity: offer.supplierName,
    price: offer.price,
  }));

  const priceHistory = data.history.map((entry) => ({
    price: entry.price,
    recordedAt: entry.recordedAt,
  }));

  return (
    <div className="space-y-5">
      <div className="panel p-5">
        <h2 className="text-lg font-semibold text-slate-900">Cross-supplier pricing</h2>
        <p className="mt-1 text-sm text-slate-500">Live offers for this product across all verified suppliers.</p>
        <div className="mt-4">
          <PriceGrid rows={gridRows} />
        </div>
      </div>

      <div className="panel p-5">
        <h2 className="text-lg font-semibold text-slate-900">Price trend</h2>
        <p className="mt-1 text-sm text-slate-500">Historical price movement for this product.</p>
        <div className="mt-4">
          <PriceChart priceHistory={priceHistory} />
        </div>
      </div>
    </div>
  );
}
