import { Injectable, Logger } from "@nestjs/common";
import { ApifyClient } from "apify-client";

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
   * Triggers (or simulates triggering) a single actor run against one (or
   * several) endpoint URL(s) and returns the resulting dataset items.
   *
   * `url` may be a single string (the common case — one
   * PricingSourceEndpoint.url) or an array of strings (a single endpoint
   * that wants to hand several pages to one actor call — see
   * PricingSourceEndpoint.apifyInput.additionalUrls, merged in by
   * PricingIngestionService before this is called).
   *
   * The shape of the actor's input payload varies by actor: some expect
   * `{ urls: [...] }`, others `{ startUrls: [{ url }, ...] }`, others a
   * single `{ url: "..." }` string. Rather than hardcoding one shape,
   * callers can set `input.urlFieldName` (read off
   * PricingSourceEndpoint.apifyInput) to "urls" | "startUrls" | "url" to
   * control how the URL(s) get embedded — defaults to "urls" (the shape
   * required by the currently-used
   * s-r/price-scraper---extract-prices-availability-from-any-url actor).
   */
  runActor(params: {
    actorId: string;
    url: string | string[];
    input?: Record<string, unknown> | null;
  }): Promise<ApifyRunResult>;
}

/**
 * Shapes { urls | startUrls | url } payload out of one-or-more URLs plus an
 * optional `urlFieldName` convention embedded in `apifyInput`. Shared by
 * both the stub and live clients so their behavior/logging stays in sync.
 *
 * `urlFieldName` values:
 *   - "urls"      -> { urls: ["https://a", "https://b"] }               (default)
 *   - "startUrls" -> { startUrls: [{ url: "https://a" }, { url: "https://b" }] }
 *   - "url"       -> { url: "https://a" }  (only the first URL is used)
 *   - anything else -> treated the same as "urls"
 */
export function buildApifyActorInput(
  url: string | string[],
  rawInput?: Record<string, unknown> | null
): Record<string, unknown> {
  const urls = Array.isArray(url) ? url : [url];
  const { urlFieldName, ...rest } = (rawInput ?? {}) as Record<string, unknown>;
  const fieldName = typeof urlFieldName === "string" && urlFieldName.trim().length > 0 ? urlFieldName : "urls";

  let urlValue: unknown;
  if (fieldName === "startUrls") {
    urlValue = urls.map((u) => ({ url: u }));
  } else if (fieldName === "url") {
    urlValue = urls[0];
  } else {
    urlValue = urls;
  }

  return { [fieldName]: urlValue, ...rest };
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
    url: string | string[];
    input?: Record<string, unknown> | null;
  }): Promise<ApifyRunResult> {
    const urlLabel = Array.isArray(params.url) ? params.url.join(", ") : params.url;
    this.logger.debug(
      `StubApifyActorClient.runActor called for actorId=${params.actorId} url(s)=${urlLabel} — ` +
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

/**
 * Live implementation, added once a human explicitly approved installing
 * `apify-client` and provided an APIFY_TOKEN (see PricingConfigService.
 * isApifyLiveEnabled() — this class is only ever bound in pricing.module.ts
 * when that flag is true; otherwise StubApifyActorClient stays in use).
 *
 * Calls actor.call() (synchronous — waits for the run to finish) then
 * fetches the resulting dataset's items. actorId is expected to be either
 * an Apify actor ID or a "username/actor-name" slug, exactly as accepted
 * by ApifyClient#actor().
 */
@Injectable()
export class LiveApifyActorClient implements ApifyActorClient {
  private readonly logger = new Logger(LiveApifyActorClient.name);
  private readonly client: ApifyClient;

  constructor() {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
      throw new Error(
        "LiveApifyActorClient requires APIFY_TOKEN to be set (PRICING_APIFY_LIVE_ENABLED=true was set without a token)."
      );
    }
    this.client = new ApifyClient({ token });
  }

  async runActor(params: {
    actorId: string;
    url: string | string[];
    input?: Record<string, unknown> | null;
  }): Promise<ApifyRunResult> {
    const urlLabel = Array.isArray(params.url) ? params.url.join(", ") : params.url;
    this.logger.log(`LiveApifyActorClient.runActor: actorId=${params.actorId} url(s)=${urlLabel}`);

    const input = buildApifyActorInput(params.url, params.input);

    try {

      const run = await this.client.actor(params.actorId).call(input);

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();

      const status: ApifyRunResult["status"] =
        run.status === "SUCCEEDED"
          ? "SUCCEEDED"
          : run.status === "TIMED-OUT"
            ? "TIMED_OUT"
            : run.status === "ABORTED"
              ? "ABORTED"
              : "FAILED";

      return {
        apifyRunId: run.id,
        apifyDatasetId: run.defaultDatasetId,
        items: items as Record<string, unknown>[],
        status,
      };
    } catch (error) {
      this.logger.error(
        `LiveApifyActorClient.runActor failed for actorId=${params.actorId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return {
        apifyRunId: `failed_${Date.now()}`,
        apifyDatasetId: "",
        items: [],
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const APIFY_ACTOR_CLIENT = "APIFY_ACTOR_CLIENT";
