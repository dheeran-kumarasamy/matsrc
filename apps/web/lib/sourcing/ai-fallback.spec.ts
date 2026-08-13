// §25 "AI failure" + §24 fallback behaviour.
//
// Verifies that the assistant remains fully usable when:
//   - no AI provider is configured (no ANTHROPIC_API_KEY)
//   - AI_PROVIDER names a provider that isn't implemented (e.g. openai today)
//   - the provider call itself throws
//
// In every case the deterministic path must produce a correct requirement and a
// correct explanation, and no provider internals may surface.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTemplateExplanation, parseRequirement, summarizeRequirement } from "./agent";
import { calculateLandedCost } from "./landed-cost";
import { rankSuppliers } from "./ranking";
import { EMPTY_REQUIREMENT, type SourcingSupplierCandidate } from "./types";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_PROVIDER;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("no AI provider configured", () => {
  it("still extracts the requirement deterministically", async () => {
    const outcome = await parseRequirement({
      message: "I need 500 bags of PPC cement delivered to Erode next week.",
      existing: { ...EMPTY_REQUIREMENT, constraints: [] },
      now: NOW,
    });

    expect(outcome.source).toBe("deterministic");
    // Not an AI *failure* — simply not configured.
    expect(outcome.aiFailed).toBe(false);
    expect(outcome.requirement.material).toBe("Cement");
    expect(outcome.requirement.quantity).toBe(500);
    expect(outcome.requirement.unit).toBe("bags");
    expect(outcome.requirement.location).toBe("Erode");
  });

  it("degrades gracefully when AI_PROVIDER names an unimplemented provider", async () => {
    process.env.AI_PROVIDER = "openai";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await parseRequirement({
      message: "20 tonnes 12mm TMT steel to Salem",
      existing: { ...EMPTY_REQUIREMENT, constraints: [] },
      now: NOW,
    });

    expect(outcome.source).toBe("deterministic");
    expect(outcome.requirement.material).toBe("TMT steel");
    expect(outcome.requirement.quantity).toBe(20);
    expect(warn).toHaveBeenCalled();
  });
});

describe("AI provider throws", () => {
  it("falls back to the deterministic requirement and records the failure", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";

    // Simulate a provider outage at the SDK boundary. The adapter dynamically
    // imports @anthropic-ai/sdk, so mocking that module is the failure-injection
    // point closest to a real outage.
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: async () => {
            throw new Error("503 upstream unavailable");
          },
        };
      },
    }));

    vi.resetModules();
    const { parseRequirement: parseWithMock } = await import("./agent");

    const outcome = await parseWithMock({
      message: "500 bags PPC cement to Erode",
      existing: { ...EMPTY_REQUIREMENT, constraints: [] },
      now: NOW,
    });

    expect(outcome.source).toBe("deterministic");
    expect(outcome.aiFailed).toBe(true);
    // The customer still gets a usable requirement.
    expect(outcome.requirement.material).toBe("Cement");
    expect(outcome.requirement.quantity).toBe(500);
    expect(outcome.requirement.location).toBe("Erode");
  });
});

describe("template explanation is always accurate without AI", () => {
  function candidate(
    overrides: Partial<SourcingSupplierCandidate> & { supplierId: string; supplierName: string }
  ): SourcingSupplierCandidate {
    return {
      location: "Erode",
      productId: "prod-1",
      productName: "PPC Cement",
      availability: "IN_STOCK",
      serviceableQuantity: 5000,
      basePrice: 355,
      unit: "bags",
      minimumOrderQuantity: null,
      deliveryAvailable: null,
      estimatedDeliveryDays: 1,
      historicalRating: 4.8,
      reliabilityScore: 96,
      specificationMatch: true,
      verifiedBadge: true,
      ...overrides,
    };
  }

  const REQUIREMENT = {
    ...EMPTY_REQUIREMENT,
    material: "Cement",
    specification: "PPC",
    quantity: 500,
    unit: "bags" as const,
    location: "Erode",
    constraints: [],
  };

  it("quotes only computed figures and discloses gaps", () => {
    const options = rankSuppliers([
      {
        candidate: candidate({ supplierId: "a", supplierName: "ABC Traders" }),
        landedCost: calculateLandedCost({
          quantity: 500,
          unitMaterialPrice: 355,
          freightCost: 6000,
          deliveryCharges: 0,
          handlingCharges: 0,
          includeTax: false,
        }),
      },
      {
        candidate: candidate({
          supplierId: "b",
          supplierName: "XYZ Materials",
          estimatedDeliveryDays: 2,
        }),
        landedCost: calculateLandedCost({
          quantity: 500,
          unitMaterialPrice: 350,
          freightCost: 12000,
          deliveryCharges: 0,
          handlingCharges: 0,
          includeTax: false,
        }),
      },
    ]);

    const text = buildTemplateExplanation(
      "Best available option based on current data",
      REQUIREMENT,
      options
    );

    expect(text).toContain("ABC Traders");
    expect(text).toContain("₹1,83,500");
    expect(text).toContain("Lowest estimated landed cost");
    expect(text).toContain("1 other option");
    // Hedged wording, never an absolute claim.
    expect(text).toContain("Best available option based on current data");
  });

  it("says pricing is unavailable rather than showing ₹0", () => {
    const options = rankSuppliers([
      {
        candidate: candidate({ supplierId: "a", supplierName: "ABC Traders", basePrice: null }),
        landedCost: calculateLandedCost({ quantity: 500, unitMaterialPrice: null }),
      },
    ]);

    const text = buildTemplateExplanation("Recommended option", REQUIREMENT, options);

    expect(text).toContain("Current pricing is unavailable");
    expect(text).not.toContain("₹0");
  });

  it("reports no supplier found without inventing one", () => {
    const text = buildTemplateExplanation("Recommended option", REQUIREMENT, []);
    expect(text).toBe("I couldn't find a supplier currently matching this requirement.");
  });

  it("summarizes the requirement for display", () => {
    expect(summarizeRequirement(REQUIREMENT)).toBe("500 bags PPC Cement to Erode");
  });
});
