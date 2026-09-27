import { describe, expect, it } from "vitest";
import {
  ORDER_CONFIRMATION_TITLE,
  ORDER_CONFIRMATION_MESSAGE,
  resolveConfirmedReference,
  buildConfirmedOrdersUrl,
} from "./order-confirmation";

describe("ORDER_CONFIRMATION_TITLE / ORDER_CONFIRMATION_MESSAGE", () => {
  it("uses the required baseline title", () => {
    expect(ORDER_CONFIRMATION_TITLE).toBe("Order Confirmed Successfully");
  });

  it("communicates confirmation, processing, the next step, and that an update will follow", () => {
    // Phase 3 requirement: only ever communicate the confirmed state + the
    // next legitimate workflow step — never claim dispatch/delivery here.
    expect(ORDER_CONFIRMATION_MESSAGE).toMatch(/confirmed/i);
    expect(ORDER_CONFIRMATION_MESSAGE).toMatch(/processing|being processed/i);
    expect(ORDER_CONFIRMATION_MESSAGE).toMatch(/supplier/i);
    expect(ORDER_CONFIRMATION_MESSAGE).toMatch(/update/i);
    expect(ORDER_CONFIRMATION_MESSAGE).not.toMatch(/dispatch|deliver|delivered|out for delivery/i);
  });
});

describe("resolveConfirmedReference", () => {
  it("returns the confirmed reference when present as a plain string", () => {
    expect(resolveConfirmedReference({ confirmed: "ABC-SITE01-000123" })).toBe("ABC-SITE01-000123");
  });

  it("returns the first value when confirmed is passed as an array (repeated query param)", () => {
    expect(resolveConfirmedReference({ confirmed: ["ABC-SITE01-000123", "other"] })).toBe(
      "ABC-SITE01-000123"
    );
  });

  it("returns null when confirmed is absent — merely visiting /orders must never show the banner", () => {
    expect(resolveConfirmedReference({})).toBeNull();
  });

  it("returns null for an empty or whitespace-only confirmed value", () => {
    expect(resolveConfirmedReference({ confirmed: "" })).toBeNull();
    expect(resolveConfirmedReference({ confirmed: "   " })).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(resolveConfirmedReference({ confirmed: [] })).toBeNull();
  });
});

describe("buildConfirmedOrdersUrl", () => {
  it("prefers the human-readable enquiryId when present", () => {
    expect(buildConfirmedOrdersUrl({ orders: [{ id: "cuid123", enquiryId: "ABC-SITE01-000123" }] })).toBe(
      "/orders?confirmed=ABC-SITE01-000123"
    );
  });

  it("falls back to the raw order id when enquiryId is missing (pre-migration orders)", () => {
    expect(buildConfirmedOrdersUrl({ orders: [{ id: "cuid123" }] })).toBe("/orders?confirmed=cuid123");
  });

  it("URL-encodes the reference", () => {
    expect(buildConfirmedOrdersUrl({ orders: [{ id: "cuid123", enquiryId: "ABC SITE 01" }] })).toBe(
      "/orders?confirmed=ABC%20SITE%2001"
    );
  });

  it("returns a plain /orders link (no query param) when there is no order in the response", () => {
    expect(buildConfirmedOrdersUrl({ orders: [] })).toBe("/orders");
    expect(buildConfirmedOrdersUrl(undefined)).toBe("/orders");
    expect(buildConfirmedOrdersUrl(null)).toBe("/orders");
  });
});
