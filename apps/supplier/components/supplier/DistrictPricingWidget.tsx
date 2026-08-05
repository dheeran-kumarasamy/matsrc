"use client";

import type { SupplierDistrictPriceRow } from "@/lib/supplier-data";

const CONFIDENCE_BADGE_CLASSES: Record<string, string> = {
  HIGH: "bg-emerald-100 text-emerald-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-200 text-slate-600",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

type Props = {
  initialRows: SupplierDistrictPriceRow[];
};

// Read-only district-wise price intelligence surface for suppliers (Phase 5
// UI integration). Data is fetched server-side once on dashboard load
// (see apps/supplier/app/(supplier)/dashboard/page.tsx) — no polling needed
// since this is passive market-reference info, not an actionable queue.
export function DistrictPricingWidget({ initialRows }: Props) {
  if (initialRows.length === 0) {
    return (
      <div className="panel overflow-hidden">
        <div className="border-b border-slate-200 px-7 py-5">
          <h3 className="text-4xl font-extrabold text-slate-900">District Price Intelligence</h3>
          <p className="mt-1 text-lg text-slate-600">
            Market reference prices for materials matching your listings, by Tamil Nadu district.
          </p>
        </div>
        <p className="px-7 py-10 text-xl text-slate-500">
          No district-wise price data available yet for your listing categories.
        </p>
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-7 py-5">
        <h3 className="text-4xl font-extrabold text-slate-900">District Price Intelligence</h3>
        <p className="mt-1 text-lg text-slate-600">
          Market reference prices for materials matching your listings, by Tamil Nadu district.
        </p>
      </div>

      <div className="divide-y divide-slate-100">
        {initialRows.map((row) => (
          <div key={`${row.canonicalSkuCode}:${row.districtCode}`} className="px-7 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xl font-bold text-slate-900">{row.materialName}</p>
                <p className="text-sm text-slate-500">
                  {row.districtName} · {row.baseUnit}
                </p>
              </div>
              <span
                className={`rounded-full px-4 py-1 text-base font-semibold ${
                  CONFIDENCE_BADGE_CLASSES[row.confidence] ?? CONFIDENCE_BADGE_CLASSES.LOW
                }`}
              >
                {row.confidence}
              </span>
            </div>

            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs uppercase text-slate-500">Median Price</p>
                <p className="text-lg font-semibold text-slate-800">{formatCurrency(row.medianPerBaseUnit)}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Range</p>
                <p className="text-lg font-semibold text-slate-800">
                  {row.minPerBaseUnit !== null && row.maxPerBaseUnit !== null
                    ? `${formatCurrency(row.minPerBaseUnit)} – ${formatCurrency(row.maxPerBaseUnit)}`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Your Avg Price</p>
                <p className="text-lg font-semibold text-slate-800">
                  {row.matsrcMedianPerBaseUnit !== null ? formatCurrency(row.matsrcMedianPerBaseUnit) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">As of</p>
                <p className="text-lg font-semibold text-slate-800">
                  {new Date(row.latestPriceDate).toLocaleDateString("en-IN")}
                </p>
              </div>
            </div>

            {row.trend.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {row.trend.map((point) => (
                  <span
                    key={point.monthStart}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-600"
                  >
                    {point.monthStart.slice(0, 7)} · {formatCurrency(point.medianPerBaseUnit)}
                    {point.momChangePct !== null
                      ? ` (${point.momChangePct > 0 ? "+" : ""}${point.momChangePct.toFixed(1)}% MoM)`
                      : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
