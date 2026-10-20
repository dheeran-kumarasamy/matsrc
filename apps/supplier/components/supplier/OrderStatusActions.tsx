"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  getAvailableActions,
  getReadOnlyStatusLabel,
  type OrderStatus,
  type TrackingEntryLike,
} from "@/lib/order-status-transitions";
import {
  ORDER_CONFIRMATION_TITLE,
  ORDER_CONFIRMATION_MESSAGE,
  shouldShowSupplierConfirmationBanner,
} from "@/lib/order-confirmation";

// Visual treatment per action, keyed by the target status the action moves
// the order *to* (not the current status) — kept separate from the
// action/transition table itself (lib/order-status-transitions.ts) so that
// shared table stays framework-agnostic and reusable server-side.
const ACTION_STYLES: Record<string, string> = {
  CANCELLED: "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100",
  PROCESSING: "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100",
};
const DEFAULT_ACTION_STYLE = "border-slate-300 text-slate-700 hover:bg-slate-50";

export function OrderStatusActions({
  orderId,
  status,
  tracking = [],
  paymentStatus,
  requiresQuotation = false,
  dispatchBlockedReason = null,
}: {
  orderId: string;
  status: OrderStatus;
  // Persisted OrderTracking rows for this order (ascending by recordedAt),
  // used only to distinguish a builder cancellation ("Cancelled by
  // Builder") from a supplier decline ("Declined by Supplier") when
  // status === "CANCELLED" — see lib/order-status-transitions.ts.
  tracking?: TrackingEntryLike[];
  // C34 (UI-level prevention only): when present and not "PAID", the
  // "Mark Delivered" action is disabled with an explanatory message
  // instead of being submitted and rejected by the server. The actual,
  // mandatory enforcement lives server-side in updateSupplierOrderStatus
  // (lib/supplier-data.ts) / OrdersService.updateStatus (apps/api) — this
  // prop only avoids a round-trip for the common case of a supplier
  // attempting delivery through this UI before payment is confirmed.
  paymentStatus?: "PENDING" | "PENDING_VERIFICATION" | "PAID" | "FAILED" | "REFUNDED";
  // Duplicate supplier-action fix (Orders: "Review and Submit Quotation" vs.
  // "Confirm Enquiry"): true only when this enquiry has a genuine
  // competing-supplier RFQ (see getSupplierOrderDetail's
  // hasMultipleEligibleCandidates doc comment in lib/supplier-data.ts). When
  // true, "Confirm Enquiry" is hidden here — the order detail page instead
  // renders RfqQuotationForm ("Review & Submit Quotation") for that case —
  // so the two actions are never shown together. "Decline Enquiry" remains
  // available either way, since declining doesn't depend on quotation
  // status. UI-level only; the authoritative guard is the equivalent check
  // in updateSupplierOrderStatus (lib/supplier-data.ts), which rejects a
  // direct CONFIRM call even if this prop is stale or bypassed.
  requiresQuotation?: boolean;
  // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
  // Dispatch (UI-level prevention only — see getSupplierOrderDetail's
  // dispatchBlockedReason doc comment in lib/supplier-data.ts): when
  // non-null, the "Mark Dispatched" action is disabled and this specific
  // reason is shown instead of being submitted and rejected by the
  // server. The actual, mandatory enforcement lives server-side in
  // checkOrderDispatchEligibility (packages/db/lib/order-dispatch-eligibility.ts),
  // called by both updateSupplierOrderStatus (lib/supplier-data.ts) and
  // OrdersService.updateStatus (apps/api) — this prop only avoids a
  // round-trip for the common case of attempting dispatch through this UI
  // before the gate is satisfied.
  dispatchBlockedReason?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only set right after a successful CONFIRM (PLACED -> PROCESSING)
  // transition, and only rendered while the order is still in the
  // resulting PROCESSING status — cleared on any other action/status so it
  // can never resurface on an unrelated later visit to this same order.
  const [justConfirmed, setJustConfirmed] = useState(false);

  async function updateStatus(nextStatus: OrderStatus) {
    setPending(nextStatus);
    setError(null);
    try {
      await axios.patch(`/api/supplier/orders/${orderId}`, { status: nextStatus });
      setJustConfirmed(nextStatus === "PROCESSING");
      router.refresh();
    } catch (err: any) {
      // Backend re-validates every transition (see updateSupplierOrderStatus
      // in lib/supplier-data.ts) and rejects anything not valid for the
      // order's *current* status with a 400 — surface that message rather
      // than silently failing, e.g. if this page's data is stale.
      setError(err?.response?.data?.message ?? "Unable to update order status right now.");
      setJustConfirmed(false);
    } finally {
      setPending(null);
    }
  }

  // Only the action(s) valid for the order's *current* status are ever
  // rendered — never a fixed list of all four possible actions. See
  // lib/order-status-transitions.ts for the underlying state machine.
  // Duplicate supplier-action fix: additionally drop "CONFIRM" whenever this
  // enquiry requires a quotation first (RfqQuotationForm is rendered for
  // that case instead) — "DECLINE" is unaffected.
  const actions = getAvailableActions(status).filter((action) => !(requiresQuotation && action.key === "CONFIRM"));
  const readOnlyLabel = getReadOnlyStatusLabel(status, tracking);

  // C34 (UI-level prevention): a "DELIVER" action is disabled whenever
  // paymentStatus is known and isn't "PAID" — mirrors (but does not
  // replace) the mandatory server-side guard in updateSupplierOrderStatus.
  // `paymentStatus === undefined` (caller didn't pass it) never disables
  // anything, so this stays backward-compatible with any other caller of
  // this component.
  const paymentBlocksDelivery = paymentStatus !== undefined && paymentStatus !== "PAID";

  // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
  // Dispatch (UI-level prevention only — mirrors paymentBlocksDelivery's
  // existing pattern). `dispatchBlockedReason === null` never disables
  // anything, so this stays backward-compatible with any other caller of
  // this component that hasn't been updated to pass it.
  const dispatchBlocked = dispatchBlockedReason !== null;

  return (
    <aside className="panel p-5">
      <h4 className="text-lg font-bold text-slate-900">Update Status</h4>
      <p className="mt-1 text-sm text-slate-600">Current status: {status}</p>

      {shouldShowSupplierConfirmationBanner({ justConfirmed, currentStatus: status }) ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-semibold text-emerald-700">{ORDER_CONFIRMATION_TITLE}</p>
          <p className="mt-1 text-xs text-emerald-700">{ORDER_CONFIRMATION_MESSAGE}</p>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p> : null}

      {actions.length > 0 ? (
        <div className="mt-3 space-y-2">
          {actions.map((action) => {
            // C34: only the DELIVER action is gated on payment — Confirm/
            // Decline are unaffected. DISPATCH is separately gated on
            // dispatchBlockedReason (Admin-Confirmed Freight / Buyer Final
            // Confirmation / Payment-Gated Dispatch).
            const disabledForPayment = action.key === "DELIVER" && paymentBlocksDelivery;
            const disabledForDispatch = action.key === "DISPATCH" && dispatchBlocked;
            const disabled = pending !== null || disabledForPayment || disabledForDispatch;
            const title = disabledForPayment
              ? "Payment must be confirmed before this order can be marked delivered."
              : disabledForDispatch
              ? dispatchBlockedReason ?? undefined
              : undefined;
            return (
              <button
                key={action.key}
                disabled={disabled}
                onClick={() => updateStatus(action.nextStatus)}
                title={title}
                className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
                  ACTION_STYLES[action.nextStatus] ?? DEFAULT_ACTION_STYLE
                }`}
              >
                {pending === action.nextStatus ? "Updating..." : action.label}
              </button>
            );
          })}
          {paymentBlocksDelivery && actions.some((action) => action.key === "DELIVER") ? (
            <p className="text-xs font-semibold text-amber-600">
              Payment must be confirmed before this order can be marked delivered.
            </p>
          ) : null}
          {dispatchBlocked && actions.some((action) => action.key === "DISPATCH") ? (
            <p className="text-xs font-semibold text-amber-600">{dispatchBlockedReason}</p>
          ) : null}
        </div>
      ) : (
        // Terminal state (Delivered/Cancelled) or an order status this table
        // doesn't recognise — never expose a possibly-invalid action, just
        // communicate that no further supplier action is required/possible.
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
          {readOnlyLabel ?? "No further action required"}
        </p>
      )}
    </aside>
  );
}
