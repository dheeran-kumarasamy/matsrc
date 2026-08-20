"use client";

import { AlertCircle, BadgeCheck, Truck } from "lucide-react";

import { describeDataGaps, formatInr, type StoredRecommendationView } from "./types";

// §9 customer-facing recommendation card.
//
// WORDING DISCIPLINE: the headline comes from the backend
// (recommendationHeadline) and is always hedged — "Best available option based on
// current data", never an unsupported absolute claim. Every figure and every
// reason shown here was computed/stored by the deterministic services; this
// component only formats them.

type Props = {
  headline: string | null;
  recommendation: StoredRecommendationView;
  alternativeCount: number;
  alternativeRange: { min: number; max: number } | null;
  unit: string | null;
};

export default function RecommendationCard({
  headline,
  recommendation,
  alternativeCount,
  alternativeRange,
  unit,
}: Props) {
  return (
    <section className="panel border-[color:var(--posh-border)] bg-[rgba(var(--posh-wash-rgb),0.04)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--posh-fg)]">
        {headline ?? "Recommended option"}
      </p>

      <div className="mt-1 flex items-center gap-1.5">
        <h2 className="text-lg font-semibold text-slate-900">{recommendation.supplierName}</h2>
        {recommendation.verifiedBadge && (
          <BadgeCheck className="h-4 w-4 text-[color:var(--posh-fg)]" aria-label="Verified supplier" />
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Estimated delivered cost
          </dt>
          <dd className="text-sm font-semibold text-slate-900">
            {formatInr(recommendation.estimatedLandedCost)}
          </dd>
          {recommendation.unitLandedCost !== null && (
            <dd className="text-xs text-slate-500">
              {formatInr(recommendation.unitLandedCost)}
              {unit ? `/${unit}` : ""}
            </dd>
          )}
        </div>

        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Delivery</dt>
          <dd className="flex items-center gap-1 text-sm text-slate-800">
            <Truck className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            {recommendation.deliveryDays === null
              ? "No verified data"
              : `${recommendation.deliveryDays} day${recommendation.deliveryDays === 1 ? "" : "s"}`}
          </dd>
        </div>

        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Supplier reliability
          </dt>
          <dd className="text-sm text-slate-800">
            {recommendation.reliabilityScore === null
              ? "Not rated yet"
              : `${Math.round(recommendation.reliabilityScore)}%`}
          </dd>
        </div>

        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Specification</dt>
          <dd className="text-sm text-slate-800">
            {recommendation.specificationMatch ? "Match" : "Partial match"}
          </dd>
        </div>
      </dl>

      {recommendation.reasons.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-slate-700">Why I recommend this supplier</h3>
          <ul className="mt-1 space-y-0.5">
            {recommendation.reasons.map((reason) => (
              <li key={reason} className="text-xs text-slate-600">
                • {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {alternativeCount > 0 && alternativeRange && (
        <p className="mt-3 text-xs text-slate-500">
          I found {alternativeCount} other option{alternativeCount === 1 ? "" : "s"} ranging from{" "}
          {formatInr(alternativeRange.min)} to {formatInr(alternativeRange.max)}
          {unit ? ` per ${unit}` : ""}.
        </p>
      )}

      {recommendation.dataGaps.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-[rgba(var(--posh-wash-rgb),0.04)] p-2 text-xs text-[color:var(--posh-fg)]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            I don&apos;t currently have verified data for:{" "}
            {describeDataGaps(recommendation.dataGaps)}. The estimate above excludes anything
            unavailable.
          </span>
        </p>
      )}
    </section>
  );
}
