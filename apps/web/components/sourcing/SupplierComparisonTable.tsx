"use client";

import { BadgeCheck } from "lucide-react";

import { describeDataGaps, formatInr, type StoredRecommendationView } from "./types";

// §16 sourcing-result comparison.
//
// FIELD CHOICE: only columns the platform can actually populate are shown —
// landed cost, delivery, reliability and spec match. Anything the schema does not
// model (MOQ, payment terms, certifications) is deliberately absent rather than
// rendered as an empty or invented column ("avoid presenting data that does not
// exist").
//
// A null figure renders as "Not available"/"No verified data", never as ₹0 or a
// dash that could be mistaken for zero.

type Props = {
  recommendations: StoredRecommendationView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function ComparisonRow({
  row,
  isSelected,
  onSelect,
}: {
  row: StoredRecommendationView;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const isTop = row.rank === 1;

  return (
    <tr
      className={`border-b border-slate-100 transition-colors ${
        isSelected ? "bg-[rgba(var(--posh-wash-rgb),0.04)]" : "hover:bg-slate-50"
      }`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 font-medium text-slate-800">
          {row.supplierName}
          {row.verifiedBadge && (
            <BadgeCheck className="h-3.5 w-3.5 text-[color:var(--posh-fg)]" aria-label="Verified supplier" />
          )}
        </div>
        {row.supplierRegion && <div className="text-xs text-slate-500">{row.supplierRegion}</div>}
      </td>

      <td className="px-4 py-3 text-right font-medium text-slate-800">
        {formatInr(row.estimatedLandedCost)}
        {row.dataGaps.includes("freight") && row.estimatedLandedCost !== null && (
          <div className="text-[11px] font-normal text-[color:var(--posh-fg)]">excl. freight</div>
        )}
      </td>

      <td className="px-4 py-3 text-right text-slate-600">
        {row.unitLandedCost === null
          ? "Not available"
          : `${formatInr(row.unitLandedCost)}${row.unit ? `/${row.unit}` : ""}`}
      </td>

      <td className="px-4 py-3 text-slate-600">
        {row.deliveryDays === null ? (
          <span className="text-slate-400">No verified data</span>
        ) : (
          `${row.deliveryDays} day${row.deliveryDays === 1 ? "" : "s"}`
        )}
      </td>

      <td className="px-4 py-3 text-right text-slate-600">
        {row.reliabilityScore === null ? (
          <span className="text-slate-400">Not rated</span>
        ) : (
          `${Math.round(row.reliabilityScore)}%`
        )}
      </td>

      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            isTop ? "bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)]" : "border border-[color:var(--posh-border)] bg-[color:var(--posh-bg-card)] text-[color:var(--posh-fg-muted)]"
          }`}
        >
          {isTop ? "Recommended" : "Alternative"}
        </span>
        {row.dataGaps.length > 0 && (
          <div className="mt-1 text-[11px] text-slate-400">
            No data: {describeDataGaps(row.dataGaps)}
          </div>
        )}
      </td>

      <td className="px-4 py-3">
        <button
          type="button"
          onClick={() => onSelect(row.id)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            isSelected
              ? "border-[color:var(--posh-primary)] bg-[color:var(--posh-primary)] text-[color:var(--posh-primary-fg)]"
              : "border-slate-200 text-slate-600 hover:border-[color:var(--posh-primary)] hover:text-[color:var(--posh-fg)]"
          }`}
          aria-pressed={isSelected}
        >
          {isSelected ? "Selected" : "Select"}
        </button>
      </td>
    </tr>
  );
}

export default function SupplierComparisonTable({ recommendations, selectedId, onSelect }: Props) {
  if (recommendations.length === 0) return null;

  return (
    <section className="panel overflow-hidden">
      <header className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Price comparison</h2>
        <p className="text-xs text-slate-500">
          Estimated landed cost includes material, freight and applicable tax where the platform has
          verified data.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-4 py-2 font-medium">
                Supplier
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Landed cost
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Per unit
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Delivery
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Reliability
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Recommendation
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                <span className="sr-only">Select</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {recommendations.map((row) => (
              <ComparisonRow
                key={row.id}
                row={row}
                isSelected={row.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
