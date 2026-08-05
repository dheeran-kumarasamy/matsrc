"use client";

import type { DistrictPricePanelHistoricalPurchase } from "@/lib/district-pricing-types";

// Purely informational market context vs a builder's own previous purchase
// — deliberately never judges the supplier the builder bought from, just
// states the facts (previous price vs current market median).
export default function HistoricalPriceContext({
  historicalPurchase,
}: {
  historicalPurchase: DistrictPricePanelHistoricalPurchase;
}) {
  if (!historicalPurchase) {
    return <p className="text-sm text-slate-400">No previous purchase history for this product yet.</p>;
  }

  const { previousPrice, previousDate, currentMedianPerDisplayUnit, diffAmount, diffPct } = historicalPurchase;
  const isIncrease = diffAmount !== null && diffAmount > 0;

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-800">Your purchase history vs. today&apos;s market</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-slate-400">You paid</p>
          <p className="font-medium text-slate-700">₹{previousPrice.toLocaleString("en-IN")}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Date purchased</p>
          <p className="font-medium text-slate-700">{previousDate}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Current market median</p>
          <p className="font-medium text-slate-700">
            {currentMedianPerDisplayUnit !== null ? `₹${currentMedianPerDisplayUnit.toLocaleString("en-IN")}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Change</p>
          <p className={`font-medium ${isIncrease ? "text-rose-600" : "text-emerald-600"}`}>
            {diffAmount !== null ? `${diffAmount > 0 ? "+" : ""}₹${diffAmount.toLocaleString("en-IN")}` : "—"}
            {diffPct !== null ? ` (${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}%)` : ""}
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        This is general market context only — it does not reflect on the supplier you purchased from.
      </p>
    </div>
  );
}
