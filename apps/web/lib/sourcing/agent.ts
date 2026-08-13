// AI Sourcing Assistant orchestrator (§13 tool-based agent, §24 fallbacks).
//
// RESPONSIBILITY SPLIT (§23), enforced here:
//   AI   -> understanding the customer's sentence, wording the explanation
//   CODE -> product matching, supplier search, prices, landed cost, ranking,
//           every currency figure, every score, every database write
//
// The agent is a DETERMINISTIC state machine that calls the LLM for exactly two
// narrow jobs (extract, explain). It is not a free-running loop that lets the
// model choose arbitrary tools: the tool sequence for a sourcing turn is fixed,
// which removes the "unauthorized tool invocation" surface entirely (§20).
//
// Both LLM calls are optional. If no provider is configured or a call fails, the
// deterministic extractor and template explanations take over and the customer
// still gets a working sourcing result (§24).

import { getAIProvider, type ExplanationContext } from "./ai/provider";
import {
  extractRequirementDeterministic,
  nextClarificationQuestion,
} from "./requirement-extractor";
import { mergeRequirements, validateRequirement } from "./requirement-schema";
import type { RankedSupplierOption, SourcingRequirement } from "./types";

/** Structured log line. Never contains keys, prompts or personal data. */
function logEvent(event: string, fields: Record<string, unknown>): void {
  const parts = Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  console.log(`[sourcing] ${event} ${parts}`);
}

export type ExtractionOutcome = {
  requirement: SourcingRequirement;
  /** Which path produced it, for observability and honest UI disclosure. */
  source: "ai" | "deterministic";
  /** True when the AI path was attempted and failed. */
  aiFailed: boolean;
  latencyMs: number;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type ExtractRequirementInput = {
  message: string;
  existing: SourcingRequirement;
  knownBrands?: string[];
  knownLocations?: string[];
  now?: Date;
};

/**
 * `parse_requirement` tool.
 *
 * Tries the AI provider first (it handles arbitrary phrasing far better), then
 * ALWAYS reconciles the result through validateRequirement + the deterministic
 * extractor, so:
 *   - anything the model invented that fails validation is dropped
 *   - anything the model missed but that is literally present in the text is
 *     still captured
 * The deterministic pass runs even on the AI path — it is a safety net, not a
 * competing implementation.
 */
export async function parseRequirement(
  input: ExtractRequirementInput
): Promise<ExtractionOutcome> {
  const started = Date.now();
  const now = input.now ?? new Date();

  const deterministic = extractRequirementDeterministic(input.message, {
    now,
    knownBrands: input.knownBrands,
    knownLocations: input.knownLocations,
  });

  let provider = null;
  try {
    provider = await getAIProvider();
  } catch (error) {
    logEvent("provider_init_failed", { error: describeError(error) });
  }

  if (!provider) {
    const latencyMs = Date.now() - started;
    logEvent("parse_requirement", { source: "deterministic", latencyMs });
    return {
      requirement: mergeRequirements(input.existing, deterministic),
      source: "deterministic",
      aiFailed: false,
      latencyMs,
    };
  }

  try {
    const result = await provider.extractRequirement(input.message, {
      existing: input.existing,
      today: now.toISOString().slice(0, 10),
      knownBrands: input.knownBrands,
      knownLocations: input.knownLocations,
    });

    // The model's output is untrusted: validate, then let the deterministic
    // extractor fill anything it missed, then merge over prior turns.
    const validated = validateRequirement(result.raw);
    const reconciled = mergeRequirements(deterministic, validated);
    const merged = mergeRequirements(input.existing, reconciled);

    const latencyMs = Date.now() - started;
    logEvent("parse_requirement", {
      source: "ai",
      provider: provider.name,
      model: result.model,
      latencyMs,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
    });

    return {
      requirement: merged,
      source: "ai",
      aiFailed: false,
      latencyMs,
      model: result.model,
      usage: result.usage,
    };
  } catch (error) {
    // §24: an AI failure must never break the request. Fall back silently to
    // the deterministic result and record it.
    const latencyMs = Date.now() - started;
    logEvent("parse_requirement_failed", {
      provider: provider.name,
      latencyMs,
      error: describeError(error),
    });
    return {
      requirement: mergeRequirements(input.existing, deterministic),
      source: "deterministic",
      aiFailed: true,
      latencyMs,
    };
  }
}

/**
 * Never leak provider internals or stack traces to a customer (§24). Only a
 * short error type/message is logged server-side.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 200)}`;
  return "UnknownError";
}

/** Indian-format currency, matching lib/builder-db.ts's formatCurrency. */
function inr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

/** One-line human summary of the requirement, used in cards and prompts. */
export function summarizeRequirement(requirement: SourcingRequirement): string {
  const bits: string[] = [];
  if (requirement.quantity !== null && requirement.unit) {
    bits.push(`${requirement.quantity.toLocaleString("en-IN")} ${requirement.unit}`);
  }
  if (requirement.specification) bits.push(requirement.specification);
  if (requirement.material) bits.push(requirement.material);
  if (requirement.brand) bits.push(`(${requirement.brand})`);
  if (requirement.location) bits.push(`to ${requirement.location}`);
  return bits.join(" ") || "Requirement not yet specified";
}

/**
 * Deterministic, always-correct explanation built purely from computed values.
 *
 * This is the baseline the customer sees. The AI version (below) only rephrases
 * it — so if the AI is unavailable the customer loses polish, never accuracy.
 */
export function buildTemplateExplanation(
  headline: string,
  requirement: SourcingRequirement,
  options: RankedSupplierOption[]
): string {
  if (options.length === 0) {
    return "I couldn't find a supplier currently matching this requirement.";
  }

  const top = options[0];
  const lines: string[] = [`${headline}: ${top.supplierName}.`];

  if (top.landedCost.estimatedLandedCost !== null) {
    lines.push(
      `Estimated delivered cost ${inr(top.landedCost.estimatedLandedCost)} for ${summarizeRequirement(
        requirement
      )}.`
    );
  } else {
    lines.push("Current pricing is unavailable for this supplier.");
  }

  if (top.reasons.length > 0) {
    lines.push(`Why: ${top.reasons.slice(0, 3).join("; ")}.`);
  }

  const alternatives = options.slice(1).filter((option) => option.landedCost.unitLandedCost !== null);
  if (alternatives.length > 0) {
    const costs = alternatives.map((option) => option.landedCost.unitLandedCost as number);
    const unit = top.candidate.unit;
    lines.push(
      `I found ${alternatives.length} other option${alternatives.length === 1 ? "" : "s"} ranging from ${inr(
        Math.min(...costs)
      )} to ${inr(Math.max(...costs))} per ${unit}.`
    );
  }

  if (top.dataGaps.length > 0) {
    lines.push(`I don't currently have verified data for: ${top.dataGaps.join(", ")}.`);
  }

  return lines.join(" ");
}

/**
 * Produces the customer-facing explanation. Attempts the AI phrasing and falls
 * back to the deterministic template on any failure.
 *
 * The AI is given ONLY already-computed facts, so it cannot alter a number.
 */
export async function explainRecommendation(
  headline: string,
  requirement: SourcingRequirement,
  options: RankedSupplierOption[]
): Promise<{ text: string; source: "ai" | "template"; aiFailed: boolean }> {
  const template = buildTemplateExplanation(headline, requirement, options);
  if (options.length === 0) {
    return { text: template, source: "template", aiFailed: false };
  }

  let provider = null;
  try {
    provider = await getAIProvider();
  } catch {
    provider = null;
  }

  if (!provider) {
    return { text: template, source: "template", aiFailed: false };
  }

  const context: ExplanationContext = {
    headline,
    requirementSummary: summarizeRequirement(requirement),
    optionLines: options.slice(0, 4).map((option) => {
      const cost =
        option.landedCost.estimatedLandedCost === null
          ? "pricing unavailable"
          : `${inr(option.landedCost.estimatedLandedCost)} estimated landed cost`;
      const days =
        option.candidate.estimatedDeliveryDays === null
          ? "delivery time unknown"
          : `${option.candidate.estimatedDeliveryDays} day delivery`;
      return `#${option.rank} ${option.supplierName}: ${cost}, ${days}, score ${option.recommendationScore}`;
    }),
    reasons: options[0].reasons,
    dataGaps: options[0].dataGaps,
  };

  const started = Date.now();
  try {
    const text = await provider.explainRecommendation(context);
    logEvent("explain_recommendation", {
      source: "ai",
      provider: provider.name,
      latencyMs: Date.now() - started,
    });
    return { text: text || template, source: "ai", aiFailed: false };
  } catch (error) {
    logEvent("explain_recommendation_failed", {
      provider: provider.name,
      latencyMs: Date.now() - started,
      error: describeError(error),
    });
    return { text: template, source: "template", aiFailed: true };
  }
}

/** Re-exported so route handlers import the whole tool surface from one place. */
export { nextClarificationQuestion };
