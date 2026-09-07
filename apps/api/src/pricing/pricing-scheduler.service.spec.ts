import { describe, expect, it, vi, beforeEach } from "vitest";
import { PricingSchedulerService } from "./pricing-scheduler.service";

function makeFakePrisma() {
  const endpoints = [
    {
      id: "ep_jindal",
      url: "https://www.jindalpanther.com/recommended-consumer-price",
      isEnabled: true,
      lastFetchedAt: null,
      sourceId: "src_jindal",
      source: {
        id: "src_jindal",
        code: "JINDAL_PANTHER",
        isEnabled: true,
        robotsAllowed: true,
        tosReviewedAt: new Date("2026-01-01"),
        apifyActorId: "apify/cheerio-scraper",
        freshnessSlaHours: 24,
      },
    },
    {
      id: "ep_agni",
      url: "https://agnisteels.com/pricing.php",
      isEnabled: true,
      lastFetchedAt: new Date(), // fresh (not due)
      sourceId: "src_agni",
      source: {
        id: "src_agni",
        code: "AGNI_STEELS",
        isEnabled: true,
        robotsAllowed: true,
        tosReviewedAt: new Date("2026-01-01"),
        apifyActorId: "apify/cheerio-scraper",
        freshnessSlaHours: 24,
      },
    },
    {
      id: "ep_disabled_src",
      url: "https://example.com/pricing",
      isEnabled: true,
      lastFetchedAt: null,
      sourceId: "src_disabled",
      source: {
        id: "src_disabled",
        code: "DISABLED_SRC",
        isEnabled: false,
        robotsAllowed: true,
        tosReviewedAt: new Date("2026-01-01"),
        apifyActorId: null,
        freshnessSlaHours: 24,
      },
    },
    {
      id: "ep_disabled_ep",
      url: "https://example.com/pricing2",
      isEnabled: false,
      lastFetchedAt: null,
      sourceId: "src_disabled_ep",
      source: {
        id: "src_disabled_ep",
        code: "DISABLED_EP_SRC",
        isEnabled: true,
        robotsAllowed: true,
        tosReviewedAt: new Date("2026-01-01"),
        apifyActorId: null,
        freshnessSlaHours: 24,
      },
    },
    {
      id: "ep_robots_false",
      url: "https://example.com/norobots",
      isEnabled: true,
      lastFetchedAt: null,
      sourceId: "src_norobots",
      source: {
        id: "src_norobots",
        code: "NOROBOTS_SRC",
        isEnabled: true,
        robotsAllowed: false,
        tosReviewedAt: new Date("2026-01-01"),
        apifyActorId: null,
        freshnessSlaHours: 24,
      },
    },
    {
      id: "ep_tos_null",
      url: "https://example.com/notos",
      isEnabled: true,
      lastFetchedAt: null,
      sourceId: "src_notos",
      source: {
        id: "src_notos",
        code: "NOTOS_SRC",
        isEnabled: true,
        robotsAllowed: true,
        tosReviewedAt: null,
        apifyActorId: null,
        freshnessSlaHours: 24,
      },
    },
    {
      id: "ep_no_extractor",
      url: "https://unknownsite.com/prices",
      isEnabled: true,
      lastFetchedAt: null,
      sourceId: "src_unknown",
      source: {
        id: "src_unknown",
        code: "UNKNOWN_SRC",
        isEnabled: true,
        robotsAllowed: true,
        tosReviewedAt: new Date("2026-01-01"),
        apifyActorId: null,
        freshnessSlaHours: 24,
      },
    },
  ];

  return {
    pricingSourceEndpoint: {
      findMany: vi.fn(async () => endpoints),
    },
    pricingScrapeRun: {
      findFirst: vi.fn(async () => null),
    },
    pricingRawObservation: {
      findMany: vi.fn(async () => []),
    },
  };
}

function makeConfig(overrides?: { isEnabled?: boolean; isApifyLiveEnabled?: boolean; isCronDryRunEnabled?: boolean }) {
  return {
    isEnabled: () => overrides?.isEnabled ?? true,
    isApifyLiveEnabled: () => overrides?.isApifyLiveEnabled ?? false,
    isCronDryRunEnabled: () => overrides?.isCronDryRunEnabled ?? false,
  };
}

function makeIngestion() {
  return {
    ingestEndpoint: vi.fn(async () => ({
      runId: "run_123",
      itemsFetched: 10,
      itemsLanded: 10,
      itemsDuplicate: 0,
    })),
  };
}

function makeNormalization() {
  return {
    normalizeEndpoint: vi.fn(async () => ({
      processed: 5,
      parsed: 5,
      unmapped: 0,
      quarantined: 0,
      rejected: 0,
    })),
  };
}

describe("PricingSchedulerService", () => {
  let prisma: any;
  let config: any;
  let ingestion: any;
  let normalization: any;
  let scheduler: PricingSchedulerService;

  beforeEach(() => {
    prisma = makeFakePrisma();
    config = makeConfig();
    ingestion = makeIngestion();
    normalization = makeNormalization();
    scheduler = new PricingSchedulerService(
      prisma,
      config,
      ingestion as any,
      normalization as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
  });

  describe("getEligibleEndpoints", () => {
    it("correctly evaluates eligibility gates and cadence due status", async () => {
      const results = await scheduler.getEligibleEndpoints();

      const jindal = results.find((r) => r.endpointId === "ep_jindal");
      expect(jindal?.eligible).toBe(true);
      expect(jindal?.due).toBe(true);
      expect(jindal?.skipReason).toBeNull();

      const agni = results.find((r) => r.endpointId === "ep_agni");
      expect(agni?.eligible).toBe(true);
      expect(agni?.due).toBe(false); // fresh

      const disabledSrc = results.find((r) => r.endpointId === "ep_disabled_src");
      expect(disabledSrc?.eligible).toBe(false);
      expect(disabledSrc?.skipReason).toContain("Source is disabled");

      const disabledEp = results.find((r) => r.endpointId === "ep_disabled_ep");
      expect(disabledEp?.eligible).toBe(false);
      expect(disabledEp?.skipReason).toContain("Endpoint is disabled");

      const robotsFalse = results.find((r) => r.endpointId === "ep_robots_false");
      expect(robotsFalse?.eligible).toBe(false);
      expect(robotsFalse?.skipReason).toContain("robotsAllowed = false");

      const tosNull = results.find((r) => r.endpointId === "ep_tos_null");
      expect(tosNull?.eligible).toBe(false);
      expect(tosNull?.skipReason).toContain("tosReviewedAt is null");

      const noExtractor = results.find((r) => r.endpointId === "ep_no_extractor");
      expect(noExtractor?.eligible).toBe(false);
      expect(noExtractor?.skipReason).toContain("No extractor registered");
    });
  });

  describe("runIngestionJob", () => {
    it("runs ingestion only for eligible and due endpoints", async () => {
      const summary = await scheduler.runIngestionJob();

      expect(summary.ok).toBe(true);
      expect(summary.dryRun).toBe(false);
      expect(summary.eligible).toBe(2); // jindal + agni
      expect(summary.due).toBe(1); // jindal
      expect(summary.started).toBe(1);
      expect(summary.succeeded).toBe(1);
      expect(ingestion.ingestEndpoint).toHaveBeenCalledWith("ep_jindal", "cron:ingest");
    });

    it("respects dryRun mode without triggering ingestEndpoint", async () => {
      const summary = await scheduler.runIngestionJob({ dryRun: true });

      expect(summary.ok).toBe(true);
      expect(summary.dryRun).toBe(true);
      expect(summary.started).toBe(0);
      expect(ingestion.ingestEndpoint).not.toHaveBeenCalled();
      expect(summary.endpoints?.find((e) => e.endpointId === "ep_jindal")?.status).toBe("WOULD_RUN");
    });

    it("prevents execution if active RUNNING scrape run exists within 15 minutes", async () => {
      prisma.pricingScrapeRun.findFirst.mockResolvedValueOnce({ id: "active_run_123" });

      const summary = await scheduler.runIngestionJob();

      expect(summary.started).toBe(0);
      expect(summary.skipped).toBeGreaterThan(0);
      expect(ingestion.ingestEndpoint).not.toHaveBeenCalled();
      expect(summary.endpoints?.find((e) => e.endpointId === "ep_jindal")?.reason).toContain("Concurrent execution in progress");
    });

    it("isolates endpoint failure without crashing the batch", async () => {
      ingestion.ingestEndpoint.mockRejectedValueOnce(new Error("Network timeout"));

      const summary = await scheduler.runIngestionJob();

      expect(summary.started).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.succeeded).toBe(0);
      expect(summary.endpoints?.find((e) => e.endpointId === "ep_jindal")?.reason).toContain("Network timeout");
    });
  });

  describe("runNormalizationJob", () => {
    it("processes pending raw observations grouped by endpoint", async () => {
      prisma.pricingRawObservation.findMany.mockResolvedValueOnce([
        { sourceId: "src_jindal", sourceUrl: "https://www.jindalpanther.com/recommended-consumer-price" },
      ]);

      const summary = await scheduler.runNormalizationJob();

      expect(summary.ok).toBe(true);
      expect(summary.dryRun).toBe(false);
      expect(summary.rawCandidates).toBe(1);
      expect(summary.endpointsProcessed).toBe(1);
      expect(normalization.normalizeEndpoint).toHaveBeenCalledWith("ep_jindal", 100);
    });

    it("supports dryRun mode for normalization without calling normalizeEndpoint", async () => {
      prisma.pricingRawObservation.findMany.mockResolvedValueOnce([
        { sourceId: "src_jindal", sourceUrl: "https://www.jindalpanther.com/recommended-consumer-price" },
      ]);

      const summary = await scheduler.runNormalizationJob({ dryRun: true });

      expect(summary.ok).toBe(true);
      expect(summary.dryRun).toBe(true);
      expect(summary.rawCandidates).toBe(1);
      expect(summary.endpointsProcessed).toBe(0);
      expect(normalization.normalizeEndpoint).not.toHaveBeenCalled();
    });
  });
});
