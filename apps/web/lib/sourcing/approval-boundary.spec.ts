// §25 "Approval" — verify that consequential actions cannot occur without
// confirmation, and §14's "AI recommends -> customer approves -> system acts".
//
// These assert STRUCTURAL properties of the implementation, which is what
// actually keeps the guarantee true as the code evolves:
//   1. The tool surface the AI can influence contains no order/money-affecting
//      write. The confirm step is a separate HTTP route driven by a button.
//   2. The turn pipeline never imports the enquiry-creation pipeline, so no
//      code path from an AI turn can reach order creation.
//   3. The confirm route requires an explicit recommendationId, blocks
//      re-confirmation, and refuses options with no verified price.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canRecommend, rankSuppliers } from "./ranking";
import { SOURCING_TOOLS } from "./types";

const SOURCING_DIR = __dirname;
const ROUTE_DIR = join(SOURCING_DIR, "../../app/api/builder/sourcing/sessions");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("the AI's tool surface contains nothing consequential", () => {
  it("exposes only read/compute tools plus the human-driven confirm step", () => {
    // Every tool the model can influence must be read-only or a pure
    // calculation. `confirm_recommendation` exists solely as an AUDIT label for
    // the customer-initiated route — the model never invokes it.
    const readOnlyTools = [
      "parse_requirement",
      "search_products",
      "find_suppliers",
      "get_current_prices",
      "calculate_landed_cost",
      "rank_suppliers",
      "get_sourcing_status",
    ];

    for (const tool of readOnlyTools) {
      expect(SOURCING_TOOLS).toContain(tool);
    }

    // No tool that places orders, moves money, or edits supplier/pricing data.
    const forbidden = [
      "place_order",
      "create_purchase_order",
      "make_payment",
      "update_supplier",
      "update_pricing",
      "cancel_order",
    ];
    for (const tool of forbidden) {
      expect(SOURCING_TOOLS).not.toContain(tool);
    }
  });

  it("has no path from the AI turn pipeline to enquiry/order creation", () => {
    const pipeline = read(join(SOURCING_DIR, "pipeline.ts"));

    // The pipeline must not import or call the order-creation pipeline.
    expect(pipeline).not.toContain("order-checkout");
    expect(pipeline).not.toContain("createOrdersFromCart");
    // Nor write to the cart, which is how an enquiry gets staged.
    expect(pipeline).not.toContain("cartItem");
  });

  it("keeps the agent (LLM-calling module) free of any database write", () => {
    const agent = read(join(SOURCING_DIR, "agent.ts"));

    expect(agent).not.toContain("createOrdersFromCart");
    expect(agent).not.toContain("prisma.");
  });
});

describe("the confirm route enforces the approval boundary", () => {
  const confirmRoute = read(join(ROUTE_DIR, "[id]/confirm/route.ts"));

  it("requires an explicitly named recommendation", () => {
    // No recommendationId -> 400. The server never chooses on the user's behalf.
    expect(confirmRoute).toContain("Select the supplier you want to proceed with.");
    expect(confirmRoute).toContain("if (!recommendationId)");
  });

  it("refuses to re-confirm an already-confirmed session", () => {
    expect(confirmRoute).toContain('session.status === "CONFIRMED"');
    expect(confirmRoute).toContain("already been confirmed");
  });

  it("refuses to proceed on an option with no verified price", () => {
    expect(confirmRoute).toContain("approved.estimatedLandedCost === null");
    expect(confirmRoute).toContain("I don't have verified pricing");
  });

  it("re-verifies the product is still active before acting", () => {
    expect(confirmRoute).toContain("isActive: true");
  });

  it("records the approval in the audit trail before performing the action", () => {
    // Scope the comparison to the function that performs the action, so the
    // top-of-file import of createOrdersFromCart doesn't skew the indexes.
    const actionBody = confirmRoute.slice(confirmRoute.indexOf("async function performApprovedSourcing"));

    const approvalIndex = actionBody.indexOf('approvalStatus: "APPROVED"');
    const actionIndex = actionBody.indexOf("await createOrdersFromCart");

    expect(approvalIndex).toBeGreaterThan(-1);
    expect(actionIndex).toBeGreaterThan(-1);
    // The audit write must come first in the action path.
    expect(approvalIndex).toBeLessThan(actionIndex);
  });

  it("reuses the existing shared enquiry pipeline rather than a forked one", () => {
    expect(confirmRoute).toContain("createOrdersFromCart");
  });
});

describe("the message route performs no consequential write", () => {
  const messageRoute = read(join(ROUTE_DIR, "[id]/message/route.ts"));

  it("never creates an order or a purchase order", () => {
    expect(messageRoute).not.toContain("createOrdersFromCart");
    expect(messageRoute).not.toContain("purchaseOrder");
  });

  it("is rate limited", () => {
    expect(messageRoute).toContain("checkRateLimit");
  });

  it("caps the customer message length", () => {
    expect(messageRoute).toContain("MAX_MESSAGE_LENGTH");
  });
});

describe("awaitingApproval gating", () => {
  it("does not offer approval when no option has a verified cost", () => {
    // canRecommend() is what the pipeline uses for awaitingApproval; with no
    // computable landed cost there is nothing a customer could approve.
    expect(canRecommend(rankSuppliers([]))).toBe(false);
  });
});
