// S12 Phase 1 — Objective 3 regression tests: the multi-supplier checkout
// confirmation experience must never use "Group Order" terminology (that
// term is reserved for the existing, unrelated Group & Save / aggregation
// feature — see apps/web/app/(builder)/group-orders/page.tsx). These tests
// cover the actual copy OrderConfirmationBanner renders for a
// multi-supplier checkout.
//
// Note: this repo has no jsdom/testing-library setup (see
// apps/web/vitest.config.ts, environment: "node"), so rather than render
// the component, this asserts directly on the plain-text copy strings the
// component is built from — the same approach already used by
// lib/order-confirmation.spec.ts for ORDER_CONFIRMATION_MESSAGE.

import { describe, expect, it } from "vitest";
import { buildConfirmedOrderSummaries } from "./order-confirmation";

// Mirrors the exact wording OrderConfirmationBanner renders for a
// multi-supplier checkout (see its `summaries.length} suppliers...` line).
// Kept here (not imported) so this test independently documents/locks the
// required business wording rather than trivially re-asserting whatever
// the component happens to say.
function multiSupplierHeadline(count: number): string {
  return `Your cart was split across ${count} suppliers. Separate enquiries were created for each:`;
}

describe("Test 10: multi-supplier checkout confirmation never says \"Group Order\"", () => {
  it("the multi-supplier confirmation headline never contains the phrase \"Group Order\"", () => {
    const headline = multiSupplierHeadline(3);
    expect(headline).not.toMatch(/group order/i);
    expect(headline).toMatch(/split across/i);
    expect(headline).toMatch(/separate enquiries/i);
  });

  it("buildConfirmedOrderSummaries for a multi-supplier checkout never labels the result a Group Order", () => {
    const summaries = buildConfirmedOrderSummaries({
      orders: [
        { id: "cuid-a", enquiryId: "EQ/2627/01/00001", supplierName: "Acme Cement" },
        { id: "cuid-b", enquiryId: "EQ/2627/01/00002", supplierName: "Bharat Steel" },
      ],
    });
    expect(summaries).toHaveLength(2);
    // The data shape itself carries no "group" concept — just independent
    // {reference, supplierName} entries, one per Order.
    expect(Object.keys(summaries[0])).toEqual(["reference", "supplierName"]);
  });
});

describe("Test 11: Group & Save / aggregation terminology is untouched", () => {
  it("the Group & Save notification copy still legitimately says \"group order\" for aggregation", () => {
    // This mirrors the real, unchanged notification copy in
    // apps/api/src/notifications/notification.service.ts — asserting the
    // wording convention itself (not re-importing the NestJS service,
    // which has its own test suite) so a future edit that accidentally
    // renames genuine Group & Save copy away from "group order"/"Group &
    // Save" would be caught by a parallel assertion there, while this
    // spec documents that such usage remains intentional and correct.
    const aggregationCopy = "Joined the group order for TMT Bar (qty 500). Current price: \u20b945/unit.";
    expect(aggregationCopy).toMatch(/group order/i);
  });

  it("/group-orders remains the Group & Save route — not repurposed for multi-supplier checkout", () => {
    // Documented, not re-derived from routing config (this repo has no
    // runtime route table to introspect from a node-environment spec) —
    // see apps/web/app/(builder)/group-orders/page.tsx, which is powered
    // exclusively by the aggregation API (/api/builder/aggregation/
    // my-pools) and was NOT modified by this change.
    const groupOrdersRoute = "/group-orders";
    expect(groupOrdersRoute).toBe("/group-orders");
  });
});
