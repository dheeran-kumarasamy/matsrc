import { afterEach, describe, expect, it, vi } from "vitest";
import { apifyActorClientFactory } from "./pricing.module";
import { LiveApifyActorClient, StubApifyActorClient } from "./apify-actor-client";
import { PricingConfigService } from "./pricing-config.service";

/**
 * Regression tests for the Vercel production startup crash: with
 * PRICING_APIFY_LIVE_ENABLED=false (or unset) and no APIFY_TOKEN,
 * LiveApifyActorClient must never be constructed at all (its constructor
 * throws without APIFY_TOKEN) — see the "IMPORTANT" comment in
 * pricing.module.ts for the full root-cause writeup.
 *
 * These tests call apifyActorClientFactory() directly (the same function
 * wired into APIFY_ACTOR_CLIENT's useFactory in the @Module decorator)
 * rather than booting a full Nest TestingModule, so they exercise exactly
 * the code path Nest itself runs at module-bootstrap time, with no
 * framework scaffolding needed.
 */
describe("apifyActorClientFactory", () => {
  const ORIGINAL_APIFY_TOKEN = process.env.APIFY_TOKEN;

  afterEach(() => {
    if (ORIGINAL_APIFY_TOKEN === undefined) {
      delete process.env.APIFY_TOKEN;
    } else {
      process.env.APIFY_TOKEN = ORIGINAL_APIFY_TOKEN;
    }
  });

  it("A: live=false + no APIFY_TOKEN -> resolves StubApifyActorClient without constructing LiveApifyActorClient", () => {
    delete process.env.APIFY_TOKEN;
    const config = { isApifyLiveEnabled: vi.fn(() => false) } as unknown as PricingConfigService;
    const stub = new StubApifyActorClient();

    // If LiveApifyActorClient were constructed here, this would throw
    // (its constructor requires APIFY_TOKEN) — so a clean return proves
    // it was never instantiated.
    const client = apifyActorClientFactory(config, stub);

    expect(client).toBe(stub);
    expect(client).not.toBeInstanceOf(LiveApifyActorClient);
  });

  it("B: live=true + no APIFY_TOKEN -> still throws (existing safety behavior preserved)", () => {
    delete process.env.APIFY_TOKEN;
    const config = { isApifyLiveEnabled: vi.fn(() => true) } as unknown as PricingConfigService;
    const stub = new StubApifyActorClient();

    expect(() => apifyActorClientFactory(config, stub)).toThrow(/APIFY_TOKEN/);
  });

  it("C: live=true + APIFY_TOKEN present -> resolves a LiveApifyActorClient instance", () => {
    process.env.APIFY_TOKEN = "test-token-value";
    const config = { isApifyLiveEnabled: vi.fn(() => true) } as unknown as PricingConfigService;
    const stub = new StubApifyActorClient();

    const client = apifyActorClientFactory(config, stub);

    expect(client).toBeInstanceOf(LiveApifyActorClient);
    expect(client).not.toBe(stub);
  });
});
