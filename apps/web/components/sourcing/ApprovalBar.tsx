"use client";

import { formatInr, type StoredRecommendationView } from "./types";

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
};

export default function ApprovalBar({
  recommendation,
  submitting,
  onProceed,
  onViewAlternatives,
  onCancel,
}: Props) {
  const hasVerifiedCost = recommendation.estimatedLandedCost !== null;

  return (
    <section className="panel sticky bottom-4 z-20 p-4">
      <p className="text-sm text-slate-800">
        {hasVerifiedCost ? (
          <>
            <span className="font-semibold">{recommendation.supplierName}</span> is recommended at an
            estimated delivered cost of{" "}
            <span className="font-semibold">{formatInr(recommendation.estimatedLandedCost)}</span>.
            Proceed with this supplier?
          </>
        ) : (
          <>
            I don&apos;t have verified pricing for{" "}
            <span className="font-semibold">{recommendation.supplierName}</span> yet, so I can&apos;t
            proceed. Select a priced option, or ask me to request a fresh quotation.
          </>
        )}
      </p>

      <p className="mt-1 text-xs text-slate-500">
        Proceeding sends an enquiry to this supplier. It does not place an order or make any payment.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onProceed}
          disabled={submitting || !hasVerifiedCost}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? "Submitting…" : "Proceed"}
        </button>
        <button
          type="button"
          onClick={onViewAlternatives}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700"
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
