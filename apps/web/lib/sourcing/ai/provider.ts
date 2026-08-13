// AI provider abstraction (§17).
//
// The rest of the sourcing feature depends ONLY on this interface — no
// provider SDK type crosses this boundary. Adding another provider later is a
// single new file plus one case in getAIProvider(); no caller changes.
//
// CURRENT STATE: the Anthropic adapter is the only one implemented, because
// @anthropic-ai/sdk + ANTHROPIC_API_KEY are the LLM integration this repo
// already has (see lib/market-insight.ts). An OpenAI adapter is deliberately
// deferred rather than stubbed — §30 requires we not leave placeholders that
// pretend a feature exists.
//
// SECURITY (§17, §20): every implementation MUST run server-side only and read
// its key from a backend environment variable. No provider key is ever sent to
// or referenced by the browser.

import type { SourcingRequirement } from "../types";

/** Provider-independent result of a requirement-extraction call. */
export type ExtractionResult = {
  /** Raw object as returned by the model, still UNVALIDATED. */
  raw: unknown;
  /** Provider/model identifiers, for observability. Never includes the key. */
  model: string;
  /** Token usage when the provider reports it (§26 cost metadata). */
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type ExtractionContext = {
  /** Requirement gathered so far, so the model only fills the gaps. */
  existing: SourcingRequirement;
  /** ISO date for resolving relative phrases like "next week". */
  today: string;
  /** Real Brand master-data names. The model must not invent brands. */
  knownBrands?: string[];
  /** Real place names, to keep location extraction grounded. */
  knownLocations?: string[];
};

/** Facts the model may summarise. It must not add to or alter them. */
export type ExplanationContext = {
  headline: string;
  requirementSummary: string;
  /** Pre-formatted, already-computed option lines. */
  optionLines: string[];
  /** Reasons produced by the deterministic ranking engine. */
  reasons: string[];
  /** Things the platform has no verified data for. */
  dataGaps: string[];
};

export interface AIProvider {
  readonly name: string;
  /** Natural language -> structured (still-unvalidated) requirement object. */
  extractRequirement(input: string, context: ExtractionContext): Promise<ExtractionResult>;
  /**
   * Turns already-computed facts into customer-facing prose. Must not
   * introduce any number or supplier not present in the context.
   */
  explainRecommendation(context: ExplanationContext): Promise<string>;
}

/**
 * Returns the configured provider, or null when no provider is available.
 *
 * Returning null (rather than throwing) is deliberate: §24 requires the app to
 * stay usable when AI is unavailable, and callers fall back to the
 * deterministic extractor + template explanations. A missing API key is a
 * degraded mode, not an outage.
 */
export async function getAIProvider(): Promise<AIProvider | null> {
  const configured = (process.env.AI_PROVIDER || "anthropic").trim().toLowerCase();

  if (configured === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    const { AnthropicSourcingProvider } = await import("./anthropic-provider");
    return new AnthropicSourcingProvider();
  }

  // Unknown/unimplemented provider (e.g. AI_PROVIDER=openai before that
  // adapter is added): log once and degrade gracefully rather than crash a
  // customer request.
  console.warn(`[sourcing] AI_PROVIDER="${configured}" is not implemented; using deterministic fallback`);
  return null;
}
