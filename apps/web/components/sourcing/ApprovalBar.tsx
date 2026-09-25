"use client";

import { formatInr, type SiteSelectionReason, type StoredRecommendationView } from "./types";
import { getSupplierDisplayName } from "@/lib/supplier-display";

// §14 human-approval boundary, in the UI.
//
// The confirmation prompt states the supplier AND the estimated delivered cost
// before asking, so the customer is never approving an unnamed amount:
//
//   "Supplier X is recommended at an estimated delivered cost of ₹3,68,000.
//    Proceed with this supplier?"   [Proceed] [View alternatives] [Cancel]
//
// The Proceed button is the ONLY path to a consequential action, and it is
// disabled while the option has no verified cost — the customer cannot be asked
// to approve a figure the platform doesn't have.

type Props = {
  recommendation: StoredRecommendationView;
  submitting: boolean;
  onProceed: () => void;
  onViewAlternatives: () => void;
  onCancel: () => void;
  /** Human-readable "Name – Location" label for the site this order is for,
   * or null while none is selected yet. Required before Proceed is enabled
   * (§7/§8 of the site-selection requirement). */
  siteLabel: string | null;
  /** Distinguishes an automatic, location-matched selection from an explicit
   * customer override — drives the mismatch warning below (§20/§21 of the
   * location-aware selection change). */
  siteSelectionReason: SiteSelectionReason;
  /** The delivery location resolved from the requirement, for the override
   * warning's wording. Null when none could be determined. */
  requestedLocation: string | null;
};

export default function ApprovalBar({
  recommendation,
  submitting,
  onProceed,
  onViewAlternatives,
  onCancel,
  siteLabel,
  siteSelectionReason,
  requestedLocation,
}: Props) {
  const hasVerifiedCost = recommendation.estimatedLandedCost !== null;
  const supplierLabel = getSupplierDisplayName(recommendation.supplierName);

  return (
    <section className="panel sticky bottom-4 z-20 p-4">
      <p className="text-sm text-slate-800">
        {hasVerifiedCost ? (
          <>
            <span className="font-semibold">{supplierLabel}</span> is recommended at an
            estimated delivered cost of{" "}
            <span className="font-semibold">{formatInr(recommendation.estimatedLandedCost)}</span>.
            Proceed with this supplier?
          </>
        ) : (
          <>
            I don&apos;t have verified pricing for{" "}
            <span className="font-semibold">{supplierLabel}</span> yet, so I can&apos;t
            proceed. Select a priced option, or ask me to request a fresh quotation.
          </>
        )}
      </p>

      <p className="mt-1 text-xs text-slate-500">
        {siteLabel ? (
          <>
            Site: <span className="font-semibold text-slate-700">{siteLabel}</span>
          </>
        ) : (
          "Select a site above before confirming — this order cannot be placed without one."
        )}
      </p>

      {/* §20/§21: the customer must never be able to accidentally confirm a
          mismatched site without having explicitly selected it — the
          selection UI (SiteStep) already requires an explicit override
          action to reach this state, but the warning is repeated here so it
          is visible at the exact moment of confirmation too. */}
      {siteLabel && siteSelectionReason === "USER_OVERRIDE" && requestedLocation ? (
        <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-800">
          ⚠ The requirement mentions <span className="font-semibold">{requestedLocation}</span>, but
          you selected <span className="font-semibold">{siteLabel}</span>. Continue with this site?
        </p>
      ) : null}

      <p className="mt-1 text-xs text-slate-500">
        Proceeding sends an enquiry to this supplier. It does not place an order or make any payment.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onProceed}
          disabled={submitting || !hasVerifiedCost || !siteLabel}
          className="posh-btn-solid rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Submitting…" : "Proceed"}
        </button>
        <button
          type="button"
          onClick={onViewAlternatives}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-[color:var(--posh-primary)] hover:text-[color:var(--posh-fg)]"
        >
          View alternatives
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
