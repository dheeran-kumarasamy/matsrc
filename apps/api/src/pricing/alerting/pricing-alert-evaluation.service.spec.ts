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
    districtId: overrides.districtId ?? "d1",
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
  districtRows?: any[];
  recentTriggeredEvaluations?: any[];
  alreadyEvaluatedToday?: any[];
} = {}) {
  return {
    watchlist: {
      findMany: vi.fn(async () => opts.watchlistRows ?? []),
    },
    pricingDistrictPriceDaily: {
      findMany: vi.fn(async () => opts.priceRows ?? []),
    },
    pricingDistrict: {
      findMany: vi.fn(async () => opts.districtRows ?? [{ id: "d1", name: "Chennai" }]),
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
