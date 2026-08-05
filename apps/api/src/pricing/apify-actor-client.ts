import { Injectable, Logger } from "@nestjs/common";

/**
 * Abstraction over "trigger a scrape and get back the resulting dataset
 * items" — deliberately actor-agnostic so PricingIngestionService never
 * talks to Apify's SDK/REST API directly.
 *
 * WHY A STUB EXISTS (read before wiring up real Apify calls):
 *   No Apify SDK (e.g. `apify-client`) is installed anywhere in this repo,
 *   and no APIFY_TOKEN/APIFY_* env vars are configured (verified by grep
 *   across every package.json and .env/.env.example in the monorepo).
 *   Phase 2's confirmed scope is "Apify actor scaffolding" — i.e. the
 *   interfaces, PricingScrapeRun bookkeeping, and pluggable client boundary
 *   — NOT installing a new external dependency without an explicit
 *   go-ahead. Per repo policy (AGENTS.md: "Dependency Management — Do not
 *   upgrade dependencies / replace libraries / change tooling versions
 *   unless explicitly requested"), this stays a no-op stub until a human
 *   confirms adding `apify-client` (or equivalent) and provisions
 *   credentials.
 *
 * HOW TO GO LIVE LATER:
 *   1. `pnpm --filter @matsrc/api add apify-client`
 *   2. Set APIFY_TOKEN (and PRICING_APIFY_LIVE_ENABLED=true) in apps/api/.env
 *   3. Implement a second class (e.g. `LiveApifyActorClient`) satisfying
 *      the same ApifyActorClient interface below, and switch the provider
 *      in pricing.module.ts to select it when
 *      PricingConfigService.isApifyLiveEnabled() is true.
 *   No other file in this module needs to change — every consumer only
 *   depends on the interface, not on a concrete client.
 */

export interface ApifyRunResult {
  apifyRunId: string;
  apifyDatasetId: string;
  /** Raw dataset items exactly as Apify would return them (untouched payloads). */
  items: Record<string, unknown>[];
  status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "ABORTED";
  errorMessage?: string;
}

export interface ApifyActorClient {
  /**
   * Triggers (or simulates triggering) a single actor run against one
   * endpoint's URL/input and returns its resulting dataset items.
   */
  runActor(params: {
    actorId: string;
    url: string;
    input?: Record<string, unknown> | null;
  }): Promise<ApifyRunResult>;
}

/**
 * No-op stub implementation. Never makes an outbound HTTP call. Returns an
 * empty, SUCCEEDED dataset every time — enough for PricingScrapeRun
 * bookkeeping and the ingestion pipeline's plumbing to be exercised
 * end-to-end (with zero raw observations landing) without depending on
 * live network access, Apify credentials, or robots/ToS clearance.
 */
@Injectable()
export class StubApifyActorClient implements ApifyActorClient {
  private readonly logger = new Logger(StubApifyActorClient.name);

  async runActor(params: {
    actorId: string;
    url: string;
    input?: Record<string, unknown> | null;
  }): Promise<ApifyRunResult> {
    this.logger.debug(
      `StubApifyActorClient.runActor called for actorId=${params.actorId} url=${params.url} — ` +
        `no real Apify SDK is installed, returning an empty simulated dataset.`
    );

    return {
      apifyRunId: `stub_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      apifyDatasetId: `stub_dataset_${Date.now()}`,
      items: [],
      status: "SUCCEEDED",
    };
  }
}

export const APIFY_ACTOR_CLIENT = "APIFY_ACTOR_CLIENT";
