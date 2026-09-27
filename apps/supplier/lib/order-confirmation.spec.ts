import { describe, expect, it } from "vitest";
import {
  ORDER_CONFIRMATION_TITLE,
  ORDER_CONFIRMATION_MESSAGE,
  shouldShowSupplierConfirmationBanner,
} from "./order-confirmation";

describe("ORDER_CONFIRMATION_TITLE / ORDER_CONFIRMATION_MESSAGE", () => {
  it("uses the required baseline title", () => {
    expect(ORDER_CONFIRMATION_TITLE).toBe("Order Confirmed Successfully");
  });

  it("communicates the confirmed state and the next legitimate step only", () => {
    expect(ORDER_CONFIRMATION_MESSAGE).toMatch(/confirm/i);
    expect(ORDER_CONFIRMATION_MESSAGE).toMatch(/processing/i);
    // Must not claim a status the supplier hasn't actually set yet.
    expect(ORDER_CONFIRMATION_MESSAGE).not.toMatch(/delivered|out for delivery/i);
  });
});

describe("shouldShowSupplierConfirmationBanner", () => {
  it("shows the banner only when the CONFIRM action just succeeded and status is PROCESSING", () => {
    expect(
      shouldShowSupplierConfirmationBanner({ justConfirmed: true, currentStatus: "PROCESSING" })
    ).toBe(true);
  });

  it("does not show the banner when the confirm action was not just performed (e.g. plain page visit)", () => {
    expect(
      shouldShowSupplierConfirmationBanner({ justConfirmed: false, currentStatus: "PROCESSING" })
    ).toBe(false);
  });

  it("does not show the banner if a different action (e.g. DISPATCH) was performed", () => {
    // justConfirmed is only ever set true for the PROCESSING transition by
    // the calling component — this covers the case where currentStatus has
    // since moved on from PROCESSING (e.g. immediately dispatched).
    expect(
      shouldShowSupplierConfirmationBanner({ justConfirmed: false, currentStatus: "DISPATCHED" })
    ).toBe(false);
  });

  it("does not show the banner after a failed confirmation attempt", () => {
    // A failed PATCH never sets justConfirmed true (see updateStatus's
    // catch branch in OrderStatusActions.tsx), so status stays whatever it
    // was before (e.g. still PLACED) and the banner condition is false.
    expect(
      shouldShowSupplierConfirmationBanner({ justConfirmed: false, currentStatus: "PLACED" })
    ).toBe(false);
  });

  it("does not resurface on an unrelated later visit to an already-PROCESSING order", () => {
    // Simulates loading the page fresh (justConfirmed starts false) for an
    // order that happens to already be PROCESSING from a previous session.
    expect(
      shouldShowSupplierConfirmationBanner({ justConfirmed: false, currentStatus: "PROCESSING" })
    ).toBe(false);
  });
});
