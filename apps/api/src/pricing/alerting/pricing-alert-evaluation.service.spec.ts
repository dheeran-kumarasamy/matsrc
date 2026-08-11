import { describe, expect, it, vi } from "vitest";
import { PricingAlertEvaluationService } from "./pricing-alert-evaluation.service";
import { ALERT_SUPPRESSION_REASONS } from "./alert-suppression-reason";

/**
 * Follows the makeFakePrisma()/buildService() pattern from
 * pricing-admin-ops.service.spec.ts. Focuses on the gaps called out in
 * docs/pricing/implementation-inventory.md §7: alert cooldown (24h),
 * duplicate-evaluation-today guard, and notification-failure isolation
 * (a failed notify() must never throw out of evaluateForDate — it must
 * persist didTrigger:true with notificationId:null instead).
 *
 * NOTE: checkAlertEligibility() (alert-eligibility.util.ts) compares
 * priceRow.priceDate against a real `new Date()` staleness clock inside the
 * service (not the priceDate argument passed to evaluateForDate), so every
 * fixture below uses "now" as the priceDate to stay within the 72h
 * freshness window regardless of when the suite is actually run.
 */
const priceDate = new Date();

function makeWatchlistRow(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? "w1",
    userId: overrides.userId ?? "builder-1",
    productId: overrides.productId ?? "product-1",
    targetPrice: overrides.targetPrice ?? 100,
    product: { id: overrides.productId ?? "product-1", name: overrides.productName ?? "Cement OPC", canonicalProductId: null },
  };
}

function makePriceRow(overrides: Record<string, any> = {}) {
  return {
    canonicalSkuId: overrides.canonicalSkuId ?? "sku-1",
    geographyLevel: overrides.geographyLevel ?? "DISTRICT",
    stateId: overrides.stateId ?? "state-tn",
    districtId: overrides.geographyLevel === "STATE" ? null : overrides.districtId ?? "d1",
    medianPerBaseUnit: overrides.medianPerBaseUnit ?? 90,
    baseUnit: overrides.baseUnit ?? "BAG",
    publicDisplayAllowed: overrides.publicDisplayAllowed ?? true,
    confidence: overrides.confidence ?? "HIGH",
    method: overrides.method ?? "OBSERVED",
    priceDate: overrides.priceDate ?? priceDate,
  };
}

function makeFakePrisma(opts: {
  watchlistRows?: any[];
  priceRows?: any[];
  stateRows?: any[];
  districtRows?: any[];
  recentTriggeredEvaluations?: any[];
  alreadyEvaluatedToday?: any[];
} = {}) {
  return {
    watchlist: {
      findMany: vi.fn(async () => opts.watchlistRows ?? []),
    },
    // Phase 6F: distinguishes DISTRICT vs STATE geographyLevel queries so
    // fixtures can exercise the STATE-fallback path realistically (the
    // service issues two separate findMany calls, one per geographyLevel).
    pricingDistrictPriceDaily: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where.geographyLevel === "STATE") return opts.stateRows ?? [];
        return opts.priceRows ?? [];
      }),
    },
    pricingDistrict: {
      findMany: vi.fn(async () => opts.districtRows ?? [{ id: "d1", name: "Chennai", stateId: "state-tn" }]),
    },
    pricingAlertEvaluation: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where.didTrigger === true) return opts.recentTriggeredEvaluations ?? [];
        return opts.alreadyEvaluatedToday ?? [];
      }),
      create: vi.fn(async (args: any) => ({ id: "eval-1", ...args.data })),
    },
  } as any;
}

function makeBridge(opts: { skuId?: string | null; districtId?: string | null } = {}) {
  return {
    resolveCanonicalSku: vi.fn(async () => (opts.skuId ? { ok: true, canonicalSkuId: opts.skuId } : { ok: false })),
    resolveDistrict: vi.fn(async () => (opts.districtId ? { ok: true, districtId: opts.districtId } : { ok: false })),
  } as any;
}

function buildService(prisma: any, bridge: any, notifications: any) {
  return new PricingAlertEvaluationService(prisma, bridge, notifications);
}

describe("PricingAlertEvaluationService.evaluateForDate — cooldown", () => {
  it("suppresses with COOLDOWN when a triggered evaluation exists for the same watchlist within the last 24h", async () => {
    const watchlistRows = [makeWatchlistRow({ targetPrice: 100 })];
    const priceRows = [makePriceRow({ medianPerBaseUnit: 90 })];
    const prisma = makeFakePrisma({
      watchlistRows,
      priceRows,
      recentTriggeredEvaluations: [{ watchlistId: "w1", evaluatedAt: new Date(priceDate.getTime() - 12 * 60 * 60 * 1000) }],
    });
    const bridge = makeBridge({ skuId: "sku-1", districtId: "d1" });
    const notifications = { notifyWatchlistPriceAlert: vi.fn() };
    const service = buildService(prisma, bridge, notifications);

    const summary = await service.evaluateForDate(priceDate);

    expect(summary.suppressedByReason[ALERT_SUPPRESSION_REASONS.COOLDOWN]).toBe(1);
    expect(notifications.notifyWatchlistPriceAlert).not.toHaveBeenCalled();
  });

  it("does not suppress with COOLDOWN when there is no prior triggered evaluation within the cooldown window", async () => {
    const watchlistRows = [makeWatchlistRow({ targetPrice: 100 })];
    const priceRows = [makePriceRow({ medianPerBaseUnit: 90 })];
    // recentTriggeredEvaluations intentionally empty (simulating the
    // service's own cooldownCutoff-scoped query finding nothing — e.g. the
    // prior trigger, if any, was more than 24h ago).
    const prisma = makeFakePrisma({ watchlistRows, priceRows, recentTriggeredEvaluations: [] });
    const bridge = makeBridge({ skuId: "sku-1", districtId: "d1" });
    const notifications = { notifyWatchlistPriceAlert: vi.fn(async () => "notif-1") };
    const service = buildService(prisma, bridge, notifications);

    const summary = await service.evaluateForDate(priceDate);

    expect(summary.triggered).toBe(1);
    expect(notifications.notifyWatchlistPriceAlert).toHaveBeenCalledTimes(1);
  });
});

describe("PricingAlertEvaluationService.evaluateForDate — duplicate-evaluation-today guard", () => {
  it("suppresses with DUPLICATE_EVALUATION and skips all other checks when the watchlist was already evaluated today", async () => {
    const watchlistRows = [makeWatchlistRow()];
    const priceRows = [makePriceRow({ medianPerBaseUnit: 90 })];
    const prisma = makeFakePrisma({
      watchlistRows,
      priceRows,
      alreadyEvaluatedToday: [{ watchlistId: "w1" }],
    });
    const bridge = makeBridge({ skuId: "sku-1", districtId: "d1" });
    const notifications = { notifyWatchlistPriceAlert: vi.fn() };
    const service = buildService(prisma, bridge, notifications);

    const summary = await service.evaluateForDate(priceDate);

    expect(summary.suppressedByReason[ALERT_SUPPRESSION_REASONS.DUPLICATE_EVALUATION]).toBe(1);
    expect(prisma.pricingAlertEvaluation.create).not.toHaveBeenCalled();
    expect(notifications.notifyWatchlistPriceAlert).not.toHaveBeenCalled();
  });
});

describe("PricingAlertEvaluationService.evaluateForDate — notification-failure isolation", () => {
  it("persists didTrigger:true with notificationId:null (instead of throwing) when notifyWatchlistPriceAlert rejects", async () => {
    const watchlistRows = [makeWatchlistRow({ targetPrice: 100 })];
    const priceRows = [makePriceRow({ medianPerBaseUnit: 90 })];
    const prisma = makeFakePrisma({ watchlistRows, priceRows });
    const bridge = makeBridge({ skuId: "sku-1", districtId: "d1" });
    const notifications = { notifyWatchlistPriceAlert: vi.fn(async () => { throw new Error("whatsapp down"); }) };
    const service = buildService(prisma, bridge, notifications);

    const summary = await service.evaluateForDate(priceDate);

    expect(summary.triggered).toBe(1);
    expect(prisma.pricingAlertEvaluation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ didTrigger: true, notificationId: null }) })
    );
  });
});

describe("PricingAlertEvaluationService.evaluateForDate — rule + eligibility suppression", () => {
  it("suppresses with RULE_NOT_TRIGGERED when currentPrice is above targetPrice", async () => {
    const watchlistRows = [makeWatchlistRow({ targetPrice: 100 })];
    const priceRows = [makePriceRow({ medianPerBaseUnit: 110 })];
    const prisma = makeFakePrisma({ watchlistRows, priceRows });
    const bridge = makeBridge({ skuId: "sku-1", districtId: "d1" });
    const notifications = { notifyWatchlistPriceAlert: vi.fn() };
    const service = buildService(prisma, bridge, notifications);

    const summary = await service.evaluateForDate(priceDate);

    expect(summary.suppressedByReason[ALERT_SUPPRESSION_REASONS.RULE_NOT_TRIGGERED]).toBe(1);
    expect(notifications.notifyWatchlistPriceAlert).not.toHaveBeenCalled();
  });

  it("suppresses with NO_PRICE when there is no PricingDistrictPriceDaily row for the resolved sku/district", async () => {
    const watchlistRows = [makeWatchlistRow({ targetPrice: 100 })];
    const prisma = makeFakePrisma({ watchlistRows, priceRows: [] });
    const bridge = makeBridge({ skuId: "sku-1", districtId: "d1" });
    const notifications = { notifyWatchlistPriceAlert: vi.fn() };
    const service = buildService(prisma, bridge, notifications);

    const summary = await service.evaluateForDate(priceDate);

    expect(summary.suppressedByReason[ALERT_SUPPRESSION_REASONS.NO_PRICE]).toBe(1);
  });

  it("suppresses via eligibility check (e.g. DERIVED_* method) rather than triggering, without persisting a canonicalSkuId-less row", async () => {
    const watchlistRows = [makeWatchlistRow({ targetPrice: 100 })];
    const priceRows = [makePriceRow({ medianPerBaseUnit: 90, method: "DERIVED_FREIGHT" })];
    const prisma = makeFakePrisma({ watchlistRows, priceRows });
    const bridge = makeBridge({ skuId: "sku-1", districtId: "d1" });
    const notifications = { notifyWatchlistPriceAlert: vi.fn() };
    const service = buildService(prisma, bridge, notifications);

    const summary = await service.evaluateForDate(priceDate);

    expect(summary.triggered).toBe(0);
    expect(notifications.notifyWatchlistPriceAlert).not.toHaveBeenCalled();
  });
});

describe("PricingAlertEvaluationService.evaluateForDate — Phase 6F STATE fallback", () => {
  it("falls back to a STATE-level price and persists geographyLevel=STATE with districtId=null when no DISTRICT row exists (never claims a district-specific price)", async () => {
    const watchlistRows = [makeWatchlistRow({ targetPrice: 100 })];
    // No DISTRICT-level row (priceRows empty); a STATE-level row exists for
    // the district's state, mirroring an AGNI-style Tamil-Nadu-wide price.
    const stateRows = [makePriceRow({ geographyLevel: "STATE", stateId: "state-tn", medianPerBaseUnit: 90 })];
    const prisma = makeFakePrisma({ watchlistRows, priceRows: [], stateRows });
    const bridge = makeBridge({ skuId: "sku-1", districtId: "d1" });
    const notifications = { notifyWatchlistPriceAlert: vi.fn(async () => "notif-1") };
    const service = buildService(prisma, bridge, notifications);

    const summary = await service.evaluateForDate(priceDate);

    expect(summary.triggered).toBe(1);
    expect(prisma.pricingAlertEvaluation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ geographyLevel: "STATE", stateId: "state-tn", districtId: null, didTrigger: true }),
      })
    );
    // Notification copy discloses the state-reference nature of the price.
    expect(notifications.notifyWatchlistPriceAlert).toHaveBeenCalledWith(
      expect.objectContaining({ districtName: expect.stringContaining("state reference") })
    );
  });

  it("prefers a DISTRICT row over a STATE row when both exist (regression: district beats state)", async () => {
    const watchlistRows = [makeWatchlistRow({ targetPrice: 100 })];
    const priceRows = [makePriceRow({ geographyLevel: "DISTRICT", districtId: "d1", medianPerBaseUnit: 74200, publicDisplayAllowed: true, confidence: "HIGH" })];
    const stateRows = [makePriceRow({ geographyLevel: "STATE", stateId: "state-tn", medianPerBaseUnit: 72730 })];
    const prisma = makeFakePrisma({ watchlistRows, priceRows, stateRows });
    const bridge = makeBridge({ skuId: "sku-1", districtId: "d1" });
    const notifications = { notifyWatchlistPriceAlert: vi.fn(async () => "notif-1") };
    const service = buildService(prisma, bridge, notifications);

    const summary = await service.evaluateForDate(priceDate);

    expect(summary.suppressedByReason[ALERT_SUPPRESSION_REASONS.RULE_NOT_TRIGGERED]).toBe(1);
    expect(prisma.pricingAlertEvaluation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ geographyLevel: "DISTRICT", districtId: "d1" }) })
    );
  });
});
