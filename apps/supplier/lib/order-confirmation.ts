// Supplier-facing "order confirmed" copy shown by
// components/supplier/OrderStatusActions.tsx only after the backend has
// actually completed the PLACED -> PROCESSING transition (never merely on
// button click — see updateStatus() in that component). Extracted into its
// own framework-agnostic module so the message content is directly
// unit-testable without a DOM/rendering environment (this app has no
// jsdom/testing-library setup — see apps/supplier/vitest.config.ts,
// environment: "node").
//
// Deliberately worded from the supplier's own perspective (they just
// performed the confirm action) rather than reusing the builder-facing
// "Order Confirmed Successfully ... The supplier will proceed ..." copy in
// apps/web/lib/order-confirmation.ts, since it would be inaccurate to tell
// the supplier that "the supplier will proceed" about their own action.
export const ORDER_CONFIRMATION_TITLE = "Order Confirmed Successfully";

export const ORDER_CONFIRMATION_MESSAGE =
  "Enquiry confirmed. The order is now marked Processing and the builder has been notified \u2014 proceed with fulfilment and update the status again once it's dispatched.";

// A supplier's "just confirmed" success banner must only ever be shown
// while (a) the action just performed was specifically the CONFIRM action
// (PLACED -> PROCESSING, never DISPATCH/DELIVER/DECLINE), AND (b) the
// order's current status is still PROCESSING — so it can never resurface
// on a later, unrelated visit to this same order's page once its status
// has moved on or the confirm attempt actually failed.
export function shouldShowSupplierConfirmationBanner(params: {
  justConfirmed: boolean;
  currentStatus: string;
}): boolean {
  return params.justConfirmed && params.currentStatus === "PROCESSING";
}
