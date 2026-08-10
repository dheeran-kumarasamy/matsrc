import { describe, expect, it, vi } from "vitest";
import { PricingIngestionService } from "./pricing-ingestion.service";

/**
 * Follows the makeFakePrisma()/buildService() pattern from
 * pricing-admin-ops.service.spec.ts. Focuses on the gaps called out in
 * docs/pricing/implementation-inventory.md §7: dedupe-hash idempotency on
 * landing, and refusal to run when the feature/source/endpoint is disabled.
 */
function makeEndpoint(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? "endpoint-1",
    sourceId: overrides.sourceId ?? "source-1",
    url: overrides.url ?? "https://example.com/prices",
    apifyInput: overrides.apifyInput ?? null,
    isEnabled: overrides.isEnabled ?? true,
    lastFetchedAt: overrides.lastFetchedAt ?? null,
    lastStatus: overrides.lastStatus ?? null,
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
    source: {
      id: overrides.sourceId ?? "source-1",
      code: overrides.sourceCode ?? "GENERIC_SRC",
      isEnabled: overrides.sourceEnabled ?? true,
      apifyActorId: overrides.apifyActorId ?? "actor-1",
      scrapeMethod: overrides.scrapeMethod ?? "APIFY_ACTOR",
    },
  };
}

function makeFakePrisma(opts: { endpoint?: any; existingDedupeHashes?: Set<string> } = {}) {
  const existing = opts.existingDedupeHashes ?? new Set<string>();
  return {
    pricingSourceEndpoint: {
      findUnique: vi.fn(async () => opts.endpoint ?? null),
      update: vi.fn(async () => ({})),
    },
    pricingScrapeRun: {
      create: vi.fn(async () => ({ id: "run-1" })),
      update: vi.fn(async () => ({})),
    },
    pricingRawObservation: {
      findUnique: vi.fn(async ({ where }: any) => (existing.has(where.dedupeHash) ? { id: "existing-raw" } : null)),
      create: vi.fn(async () => ({})),
    },
  } as any;
}

function buildService(prisma: any, config: any, actorClient: any, nativeExtractorClient: any = { runActor: vi.fn() }) {
  return new PricingIngestionService(prisma, config, actorClient, nativeExtractorClient);
}

const enabledConfig = { isEnabled: () => true, isApifyLiveEnabled: () => false } as any;

describe("PricingIngestionService.ingestEndpoint", () => {
  it("refuses to run when the pricing feature flag is disabled", async () => {
    const prisma = makeFakePrisma({ endpoint: makeEndpoint() });
    const config = { isEnabled: () => false, isApifyLiveEnabled: () => false } as any;
    const actorClient = { runActor: vi.fn() };
    const service = buildService(prisma, config, actorClient);

    await expect(service.ingestEndpoint("endpoint-1")).rejects.toThrow(/disabled/i);
    expect(actorClient.runActor).not.toHaveBeenCalled();
  });

  it("refuses to run when the endpoint itself is disabled", async () => {
    const prisma = makeFakePrisma({ endpoint: makeEndpoint({ isEnabled: false }) });
    const actorClient = { runActor: vi.fn() };
    const service = buildService(prisma, enabledConfig, actorClient);

    await expect(service.ingestEndpoint("endpoint-1")).rejects.toThrow(/not enabled/i);
    expect(actorClient.runActor).not.toHaveBeenCalled();
  });

  it("refuses to run when the parent source is disabled", async () => {
    const prisma = makeFakePrisma({ endpoint: makeEndpoint({ sourceEnabled: false }) });
    const actorClient = { runActor: vi.fn() };
    const service = buildService(prisma, enabledConfig, actorClient);

    await expect(service.ingestEndpoint("endpoint-1")).rejects.toThrow(/not enabled/i);
    expect(actorClient.runActor).not.toHaveBeenCalled();
  });

  it("lands only non-duplicate items, skipping any whose dedupeHash already exists (idempotent re-run)", async () => {
    const endpoint = makeEndpoint();
    const prisma = makeFakePrisma({ endpoint });
    const actorClient = {
      runActor: vi.fn(async () => ({
        status: "SUCCEEDED",
        items: [
          { title: "Cement OPC", price: "350", unit: "bag", location: "Chennai", date: "2026-01-10" },
          { title: "TMT Bar", price: "60", unit: "kg", location: "Madurai", date: "2026-01-10" },
        ],
        apifyRunId: "apify-run-1",
        apifyDatasetId: "dataset-1",
        errorMessage: null,
      })),
    };
    const service = buildService(prisma, enabledConfig, actorClient);

    // First item's dedupeHash will be computed deterministically; force one
    // of the two computed hashes to already exist by intercepting after the
    // first findUnique call resolves the real hash the service computed.
    let callCount = 0;
    (prisma.pricingRawObservation.findUnique as any).mockImplementation(async ({ where }: any) => {
      callCount++;
      // Mark the first checked hash as a duplicate; let the second land.
      return callCount === 1 ? { id: "existing-raw" } : null;
    });

    const result = await service.ingestEndpoint("endpoint-1");

    expect(result.itemsFetched).toBe(2);
    expect(result.itemsDuplicate).toBe(1);
    expect(result.itemsLanded).toBe(1);
    expect(prisma.pricingRawObservation.create).toHaveBeenCalledTimes(1);
  });

  it("marks the scrape run FAILED and rethrows when the actor client throws", async () => {
    const endpoint = makeEndpoint();
    const prisma = makeFakePrisma({ endpoint });
    const actorClient = { runActor: vi.fn(async () => { throw new Error("actor exploded"); }) };
    const service = buildService(prisma, enabledConfig, actorClient);

    await expect(service.ingestEndpoint("endpoint-1")).rejects.toThrow("actor exploded");

    expect(prisma.pricingScrapeRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({ status: "FAILED", errorMessage: "actor exploded" }),
      })
    );
    expect(prisma.pricingRawObservation.create).not.toHaveBeenCalled();
  });

  it("marks the endpoint's consecutiveFailures reset to 0 on a successful run", async () => {
    const endpoint = makeEndpoint({ consecutiveFailures: 3 });
    const prisma = makeFakePrisma({ endpoint });
    const actorClient = {
      runActor: vi.fn(async () => ({
        status: "SUCCEEDED",
        items: [],
        apifyRunId: "apify-run-1",
        apifyDatasetId: "dataset-1",
        errorMessage: null,
      })),
    };
    const service = buildService(prisma, enabledConfig, actorClient);

    await service.ingestEndpoint("endpoint-1");

    expect(prisma.pricingSourceEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ consecutiveFailures: 0 }) })
    );
  });
});
