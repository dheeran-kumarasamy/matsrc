import { describe, expect, it } from "vitest";
import {
  ORDER_CONFIRMATION_TITLE,
  ORDER_CONFIRMATION_MESSAGE,
  resolveConfirmedReference,
  resolveConfirmedReferences,
  buildConfirmedOrdersUrl,
  buildConfirmedOrderSummaries,
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

  // S12 Phase 1 — Test 2/Test 3: multi-supplier checkout must never silently
  // discard sibling Order references.
  it("Test 2: preserves BOTH enquiry references for a two-supplier checkout", () => {
    expect(
      buildConfirmedOrdersUrl({
        orders: [
          { id: "cuid-a", enquiryId: "EQ/2627/01/00001" },
          { id: "cuid-b", enquiryId: "EQ/2627/01/00002" },
        ],
      })
    ).toBe("/orders?confirmed=EQ%2F2627%2F01%2F00001,EQ%2F2627%2F01%2F00002");
  });

  it("Test 3: preserves ALL THREE enquiry references for a three-supplier checkout", () => {
    const url = buildConfirmedOrdersUrl({
      orders: [
        { id: "cuid-a", enquiryId: "EQ/2627/01/00001" },
        { id: "cuid-b", enquiryId: "EQ/2627/01/00002" },
        { id: "cuid-c", enquiryId: "EQ/2627/01/00003" },
      ],
    });
    const decoded = decodeURIComponent(url.split("?confirmed=")[1]);
    expect(decoded.split(",")).toEqual(["EQ/2627/01/00001", "EQ/2627/01/00002", "EQ/2627/01/00003"]);
  });
});

describe("resolveConfirmedReferences", () => {
  it("Test 1: a single-supplier checkout resolves to exactly one reference", () => {
    expect(resolveConfirmedReferences({ confirmed: "EQ/2627/01/00001" })).toEqual(["EQ/2627/01/00001"]);
  });

  it("Test 2: a two-supplier checkout's comma-separated param resolves to both references", () => {
    expect(resolveConfirmedReferences({ confirmed: "EQ/2627/01/00001,EQ/2627/01/00002" })).toEqual([
      "EQ/2627/01/00001",
      "EQ/2627/01/00002",
    ]);
  });

  it("Test 3: a three-supplier checkout's comma-separated param resolves to all three references", () => {
    expect(resolveConfirmedReferences({ confirmed: "EQ/2627/01/00001,EQ/2627/01/00002,EQ/2627/01/00003" })).toEqual([
      "EQ/2627/01/00001",
      "EQ/2627/01/00002",
      "EQ/2627/01/00003",
    ]);
  });

  it("returns an empty array when confirmed is absent", () => {
    expect(resolveConfirmedReferences({})).toEqual([]);
  });

  it("ignores empty segments produced by stray commas/whitespace", () => {
    expect(resolveConfirmedReferences({ confirmed: "EQ/1, ,EQ/2,," })).toEqual(["EQ/1", "EQ/2"]);
  });
});

describe("buildConfirmedOrderSummaries", () => {
  it("Test 4: never uses the internal cuid as the reference when enquiryId is present", () => {
    const summaries = buildConfirmedOrderSummaries({
      orders: [{ id: "cuid-internal-only", enquiryId: "EQ/2627/01/00001", supplierName: "Acme Cement" }],
    });
    expect(summaries).toEqual([{ reference: "EQ/2627/01/00001", supplierName: "Acme Cement" }]);
    expect(summaries[0].reference).not.toBe("cuid-internal-only");
  });

  it("includes supplier names for a multi-supplier checkout when the checkout response already provides them", () => {
    const summaries = buildConfirmedOrderSummaries({
      orders: [
        { id: "cuid-a", enquiryId: "EQ/2627/01/00001", supplierName: "Acme Cement" },
        { id: "cuid-b", enquiryId: "EQ/2627/01/00002", supplierName: "Bharat Steel" },
      ],
    });
    expect(summaries).toEqual([
      { reference: "EQ/2627/01/00001", supplierName: "Acme Cement" },
      { reference: "EQ/2627/01/00002", supplierName: "Bharat Steel" },
    ]);
  });

  it("omits supplierName (never a placeholder string) when the response doesn't provide it", () => {
    const summaries = buildConfirmedOrderSummaries({ orders: [{ id: "cuid-a", enquiryId: "EQ/2627/01/00001" }] });
    expect(summaries[0].supplierName).toBeUndefined();
  });

  it("returns an empty array for an empty/missing response", () => {
    expect(buildConfirmedOrderSummaries({ orders: [] })).toEqual([]);
    expect(buildConfirmedOrderSummaries(undefined)).toEqual([]);
    expect(buildConfirmedOrderSummaries(null)).toEqual([]);
  });
});
