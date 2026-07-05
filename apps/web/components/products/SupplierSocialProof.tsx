"use client";

import { useEffect, useMemo, useState } from "react";
import { getAnchoring, getSupplierRatingsSummary, recordInterestEvent } from "@/lib/interest-events";

type Props = {
  listingId: string;
  supplierId: string;
  showViewTracking?: boolean;
  acceptedContext?: boolean;
};

type RatingsSummary = {
  avgDeliveryRating: number | null;
  avgQualityRating: number | null;
  totalRatings: number;
  insufficientData: boolean;
};

type Anchoring = {
  viewersLast24h: number;
  lockedPercent: number | null;
};

export default function SupplierSocialProof({
  listingId,
  supplierId,
  showViewTracking = false,
  acceptedContext = false,
}: Props) {
  const [ratings, setRatings] = useState<RatingsSummary | null>(null);
  const [anchoring, setAnchoring] = useState<Anchoring | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [ratingsData, anchoringData] = await Promise.all([
          getSupplierRatingsSummary(supplierId),
          getAnchoring(listingId),
        ]);

        if (!active) return;
        setRatings(ratingsData);
        setAnchoring(anchoringData);
      } catch {
        if (!active) return;
        setRatings(null);
        setAnchoring(null);
      }
    }

    void load();

    if (showViewTracking) {
      void recordInterestEvent(listingId, "VIEW");
    }

    return () => {
      active = false;
    };
  }, [listingId, showViewTracking, supplierId]);

  const ratingsLine = useMemo(() => {
    if (!ratings) return null;
    if (ratings.insufficientData) {
      return "New supplier - not enough ratings yet";
    }

    return `⭐ ${ratings.avgDeliveryRating?.toFixed(1) ?? "-"} delivery · ⭐ ${ratings.avgQualityRating?.toFixed(1) ?? "-"} product quality (from ${ratings.totalRatings} ratings)`;
  }, [ratings]);

  const showAnchoring = Boolean(anchoring && anchoring.lockedPercent !== null);

  if (!ratingsLine && !showAnchoring) {
    return null;
  }

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${acceptedContext ? "border-blue-100 bg-blue-50" : "border-slate-200 bg-white"}`}>
      {acceptedContext ? <p className="font-semibold text-slate-800">Why this is a strong choice</p> : null}
      {ratingsLine ? <p className="mt-1 text-slate-700">{ratingsLine}</p> : null}
      {showAnchoring ? (
        <>
          <p className="mt-2 text-slate-700">👀 {anchoring?.viewersLast24h.toLocaleString("en-IN")} people viewed this in the last 24 hours</p>
          <p className="mt-1 text-slate-700">🔒 {anchoring?.lockedPercent}% of viewers locked the price by ordering</p>
        </>
      ) : null}
    </div>
  );
}
