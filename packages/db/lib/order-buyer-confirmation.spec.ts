import { describe, it, expect } from "vitest";
import {
  resolveBuyerConfirmationState,
  resolveOrderFinalPayableAmount,
  BUYER_CONFIRMATION_STATE_LABELS,
} from "./order-buyer-confirmation";

describe("resolveBuyerConfirmationState", () => {
  it("is NOT_YET_CONFIRMED while the order is still PLACED, regardless of SupplierInvoice", () => {
    expect(resolveBuyerConfirmationState("PLACED", null)).toBe("NOT_YET_CONFIRMED");
    expect(resolveBuyerConfirmationState("PLACED", { status: "CONFIRMED" })).toBe("NOT_YET_CONFIRMED");
  });

  it("is AWAITING_FINAL_CONFIRMATION once the supplier accepts but no SupplierInvoice exists yet", () => {
    expect(resolveBuyerConfirmationState("PROCESSING", null)).toBe("AWAITING_FINAL_CONFIRMATION");
  });

  it("is AWAITING_FINAL_CONFIRMATION while the SupplierInvoice is PENDING_REVIEW", () => {
    expect(resolveBuyerConfirmationState("PROCESSING", { status: "PENDING_REVIEW" })).toBe("AWAITING_FINAL_CONFIRMATION");
  });

  it("is AWAITING_FINAL_CONFIRMATION while the SupplierInvoice is REJECTED", () => {
    expect(resolveBuyerConfirmationState("PROCESSING", { status: "REJECTED" })).toBe("AWAITING_FINAL_CONFIRMATION");
  });

  it("is CONFIRMED once the supplier has accepted AND the SupplierInvoice is CONFIRMED", () => {
    expect(resolveBuyerConfirmationState("PROCESSING", { status: "CONFIRMED" })).toBe("CONFIRMED");
  });

  it("remains CONFIRMED for later statuses (DISPATCHED/OUT_FOR_DELIVERY/DELIVERED) once the invoice is confirmed", () => {
    expect(resolveBuyerConfirmationState("DISPATCHED", { status: "CONFIRMED" })).toBe("CONFIRMED");
    expect(resolveBuyerConfirmationState("OUT_FOR_DELIVERY", { status: "CONFIRMED" })).toBe("CONFIRMED");
    expect(resolveBuyerConfirmationState("DELIVERED", { status: "CONFIRMED" })).toBe("CONFIRMED");
  });

  // Legacy/in-flight order compatibility policy — an order that has
  // ALREADY shipped (DISPATCHED/OUT_FOR_DELIVERY/DELIVERED) is treated as
  // CONFIRMED for buyer-facing display purposes, even with no (or a
  // not-yet-CONFIRMED) SupplierInvoice — see resolveBuyerConfirmationState's
  // own doc comment for the full rationale (this is presentation-only; it
  // never bypasses the dispatch gate itself for a NEW transition).
  it("treats an already-DISPATCHED/OUT_FOR_DELIVERY/DELIVERED order as CONFIRMED even with no SupplierInvoice (legacy grandfathering)", () => {
    expect(resolveBuyerConfirmationState("DISPATCHED", null)).toBe("CONFIRMED");
    expect(resolveBuyerConfirmationState("OUT_FOR_DELIVERY", null)).toBe("CONFIRMED");
    expect(resolveBuyerConfirmationState("DELIVERED", null)).toBe("CONFIRMED");
  });

  it("treats an already-DISPATCHED/DELIVERED order as CONFIRMED even with a merely PENDING_REVIEW/REJECTED SupplierInvoice (legacy grandfathering)", () => {
    expect(resolveBuyerConfirmationState("DISPATCHED", { status: "PENDING_REVIEW" })).toBe("CONFIRMED");
    expect(resolveBuyerConfirmationState("DELIVERED", { status: "REJECTED" })).toBe("CONFIRMED");
  });

  it("PROCESSING still correctly stays AWAITING_FINAL_CONFIRMATION (the grandfathering exception is narrowly scoped to DISPATCHED-or-later only)", () => {
    expect(resolveBuyerConfirmationState("PROCESSING", null)).toBe("AWAITING_FINAL_CONFIRMATION");
    expect(resolveBuyerConfirmationState("PROCESSING", { status: "PENDING_REVIEW" })).toBe("AWAITING_FINAL_CONFIRMATION");
  });

  it("CANCELLED always wins, even if the SupplierInvoice was confirmed", () => {
    expect(resolveBuyerConfirmationState("CANCELLED", { status: "CONFIRMED" })).toBe("CANCELLED");
    expect(resolveBuyerConfirmationState("CANCELLED", null)).toBe("CANCELLED");
  });

  it("every BuyerConfirmationState has a human-readable label", () => {
    expect(BUYER_CONFIRMATION_STATE_LABELS.NOT_YET_CONFIRMED).toBeTruthy();
    expect(BUYER_CONFIRMATION_STATE_LABELS.AWAITING_FINAL_CONFIRMATION).toBeTruthy();
    expect(BUYER_CONFIRMATION_STATE_LABELS.CONFIRMED).toBeTruthy();
    expect(BUYER_CONFIRMATION_STATE_LABELS.CANCELLED).toBeTruthy();
  });
});

describe("resolveOrderFinalPayableAmount", () => {
  it("uses the pre-confirmation estimate when there is no SupplierInvoice", () => {
    const result = resolveOrderFinalPayableAmount(12980, null);
    expect(result).toEqual({ amount: 12980, isFinalConfirmed: false });
  });

  it("uses the pre-confirmation estimate while the SupplierInvoice is PENDING_REVIEW", () => {
    const result = resolveOrderFinalPayableAmount(12980, { status: "PENDING_REVIEW", confirmedTotalAmount: null });
    expect(result).toEqual({ amount: 12980, isFinalConfirmed: false });
  });

  it("uses the pre-confirmation estimate while the SupplierInvoice is REJECTED", () => {
    const result = resolveOrderFinalPayableAmount(12980, { status: "REJECTED", confirmedTotalAmount: null });
    expect(result).toEqual({ amount: 12980, isFinalConfirmed: false });
  });

  it("uses the admin-confirmed total once the SupplierInvoice is CONFIRMED — even when HIGHER than the pre-confirmation estimate", () => {
    const result = resolveOrderFinalPayableAmount(12980, { status: "CONFIRMED", confirmedTotalAmount: 14500 });
    expect(result).toEqual({ amount: 14500, isFinalConfirmed: true });
  });

  it("uses the admin-confirmed total even when LOWER than the pre-confirmation estimate (e.g. a discount)", () => {
    const result = resolveOrderFinalPayableAmount(12980, { status: "CONFIRMED", confirmedTotalAmount: 11000 });
    expect(result).toEqual({ amount: 11000, isFinalConfirmed: true });
  });

  it("falls back to the pre-confirmation estimate if a CONFIRMED invoice has a null confirmedTotalAmount (defensive — should be structurally impossible)", () => {
    const result = resolveOrderFinalPayableAmount(12980, { status: "CONFIRMED", confirmedTotalAmount: null });
    expect(result).toEqual({ amount: 12980, isFinalConfirmed: false });
  });
});
