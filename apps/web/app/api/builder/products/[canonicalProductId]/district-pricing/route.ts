import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import {
  buildSourceBreakdown,
  computeDiffPct,
  computeFreshness,
  computeMarketPosition,
  toMethodLabel,
} from "@/lib/district-pricing";
import type { DistrictPricingPanelResponse } from "@/lib/district-pricing-types";

export const dynamic = "force-dynamic";

// Builder Product Detail Page — "District Price Intelligence" panel data
// (Phase 6A). Direct-Prisma, builder-only, additive — sits alongside (not
// instead of) the existing cross-supplier price-comparison route. Reads
// ONLY from the existing Price Intelligence serving layer
// (PricingDistrictPriceDaily / PricingTrendMonthly / PricingDistrict) —
// no schema changes, no ingestion changes.
//
// Product -> PricingCanonicalSku bridging strategy (documented, approved):
//   1. Exact: PricingCanonicalSku.matsrcListingId === Product.id
//   2. Fallback: unambiguous match on MaterialCategory name ~ Product
//      category name AND PricingBrand name ~ Product brand name.
//   If neither resolves, `resolved: false` is returned with emptyReason
//   "NO_SKU_MATCH" — the panel must render an explicit empty state, never a
//   guess.
//
// License/visibility rule: only rows with publicDisplayAllowed = true are
// ever read for the daily/trend/comparison data (same gating as
// public-pricing.controller.ts). Source attribution only ever exposes
// ATTRIBUTION_REQUIRED / PUBLIC_DOMAIN / OWN_DATA sources — INTERNAL_ONLY
// sources are never named, matching the existing serving-layer convention
// where publicDisplayAllowed is false whenever any INTERNAL_ONLY source
// contributed.
export async function GET(request: Request, { params }: { params: { canonicalProductId: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const { canonicalProductId } = params;
    if (!canonicalProductId) {
      return NextResponse.json({ error: "canonicalProductId is required" }, { status: 400 });
    }

    const url = new URL(request.url);
    const requestedDistrictCode = url.searchParams.get("district");
    const listingPriceParam = url.searchParams.get("listingPrice");
    const listingPricePerBaseUnit = listingPriceParam ? Number(listingPriceParam) : null;

    const canonicalProduct = await prisma.canonicalProduct.findUnique({
      where: { id: canonicalProductId },
      select: {
        id: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
      },
    });
    if (!canonicalProduct) {
      return NextResponse.json({ error: "Canonical product not found" }, { status: 404 });
    }

    // ── Step 1: resolve Product -> PricingCanonicalSku ───────────────────
    let sku = await prisma.pricingCanonicalSku.findFirst({
      where: { matsrcListingId: canonicalProductId },
      select: { id: true, materialCategory: { select: { name: true } } },
    });

    if (!sku) {
      const categoryName = canonicalProduct.category?.name?.trim();
      const brandName = canonicalProduct.brand?.name?.trim();
      if (categoryName) {
        const candidates = await prisma.pricingCanonicalSku.findMany({
          where: {
            isActive: true,
            materialCategory: { name: { equals: categoryName, mode: "insensitive" } },
            ...(brandName ? { brand: { name: { equals: brandName, mode: "insensitive" } } } : {}),
          },
          select: { id: true, materialCategory: { select: { name: true } } },
          take: 2,
        });
        // Only accept an unambiguous single match — never guess between
        // multiple candidates.
        if (candidates.length === 1) {
          sku = candidates[0];
        }
      }
    }

    const emptyBase: DistrictPricingPanelResponse = {
      resolved: false,
      emptyReason: "NO_SKU_MATCH",
      selectedDistrict: null,
      isDistrictFallback: false,
      availableDistricts: [],
      current: null,
      trend: [],
      nearbyDistricts: [],
      sourceBreakdown: [],
      marketPosition: null,
      marketPositionUnavailableReason: "NO_DATA",
      historicalPurchase: null,
    };

    if (!sku) {
      return NextResponse.json(emptyBase);
    }

    // ── Step 2: resolve district (builder's site district by default) ───
    const sites = await prisma.site.findMany({
      where: { builderId: user.id },
      select: { city: true },
    });
    const siteCities = Array.from(
      new Set(sites.map((s) => s.city).filter((c): c is string => Boolean(c && c.trim())))
    );

    const districtsWithData = await prisma.pricingDistrictPriceDaily.findMany({
      where: { canonicalSkuId: sku.id, publicDisplayAllowed: true },
      distinct: ["districtId"],
      select: { districtId: true },
    });
    const availableDistrictIds = districtsWithData.map((d) => d.districtId);

    if (availableDistrictIds.length === 0) {
      return NextResponse.json({ ...emptyBase, emptyReason: "NO_DISTRICT_DATA" });
    }

    const allAvailableDistricts = await prisma.pricingDistrict.findMany({
      where: { id: { in: availableDistrictIds } },
      orderBy: { name: "asc" },
    });

    let selectedDistrict = requestedDistrictCode
      ? allAvailableDistricts.find((d) => d.code === requestedDistrictCode) ?? null
      : null;
    let isDistrictFallback = false;

    if (!selectedDistrict) {
      if (!requestedDistrictCode && siteCities.length > 0) {
        selectedDistrict =
          allAvailableDistricts.find((d) => siteCities.some((c) => c.toLowerCase() === d.name.toLowerCase())) ?? null;
      }
      if (!selectedDistrict) {
        // Fall back to the first available district — never silently swap
        // to a different one without telling the caller (isDistrictFallback).
        selectedDistrict = allAvailableDistricts[0] ?? null;
        isDistrictFallback = true;
      }
    }

    if (!selectedDistrict) {
      return NextResponse.json({ ...emptyBase, emptyReason: "NO_DISTRICT_DATA" });
    }

    // ── Step 3: current daily snapshot for the selected district ────────
    const currentRow = await prisma.pricingDistrictPriceDaily.findFirst({
      where: { canonicalSkuId: sku.id, districtId: selectedDistrict.id, publicDisplayAllowed: true },
      orderBy: { priceDate: "desc" },
    });

    if (!currentRow) {
      return NextResponse.json({
        ...emptyBase,
        emptyReason: "NO_DISTRICT_DATA",
        availableDistricts: allAvailableDistricts.map((d) => ({ code: d.code, name: d.name })),
      });
    }

    const anchorDistrict = currentRow.anchorDistrictId
      ? await prisma.pricingDistrict.findUnique({ where: { id: currentRow.anchorDistrictId }, select: { name: true } })
      : null;

    const now = new Date();
    const freshness = computeFreshness(currentRow.priceDate, now, 24 * 3);

    const current: DistrictPricingPanelResponse["current"] = {
      priceDate: currentRow.priceDate.toISOString().slice(0, 10),
      baseUnit: currentRow.baseUnit,
      displayUnit: currentRow.displayUnit ?? null,
      medianPerBaseUnit: Number(currentRow.medianPerBaseUnit),
      medianPerDisplayUnit: currentRow.medianPerDisplayUnit !== null ? Number(currentRow.medianPerDisplayUnit) : null,
      p25PerBaseUnit: currentRow.p25PerBaseUnit !== null ? Number(currentRow.p25PerBaseUnit) : null,
      p75PerBaseUnit: currentRow.p75PerBaseUnit !== null ? Number(currentRow.p75PerBaseUnit) : null,
      minPerBaseUnit: currentRow.minPerBaseUnit !== null ? Number(currentRow.minPerBaseUnit) : null,
      maxPerBaseUnit: currentRow.maxPerBaseUnit !== null ? Number(currentRow.maxPerBaseUnit) : null,
      observationCount: currentRow.observationCount,
      sourceCount: currentRow.sourceCount,
      method: currentRow.method,
      methodLabel: toMethodLabel(currentRow.method),
      confidence: currentRow.confidence,
      anchorDistrictName: anchorDistrict?.name ?? null,
      matsrcMedianPerBaseUnit:
        currentRow.matsrcMedianPerBaseUnit !== null ? Number(currentRow.matsrcMedianPerBaseUnit) : null,
      freshnessLabel: freshness.label,
      isStale: freshness.isStale,
    };

    // ── Step 4: 12-month trend ───────────────────────────────────────────
    const trendRows = await prisma.pricingTrendMonthly.findMany({
      where: { canonicalSkuId: sku.id, districtId: selectedDistrict.id },
      orderBy: { monthStart: "desc" },
      take: 12,
    });
    const trend = trendRows
      .map((t) => ({
        monthStart: t.monthStart.toISOString().slice(0, 10),
        medianPerBaseUnit: Number(t.medianPerBaseUnit),
        momChangePct: t.momChangePct !== null ? Number(t.momChangePct) : null,
        yoyChangePct: t.yoyChangePct !== null ? Number(t.yoyChangePct) : null,
        confidence: t.confidence,
        dayCount: t.dayCount,
      }))
      .reverse();

    // ── Step 5: nearby district comparison (latest row per district) ────
    const otherDistrictIds = availableDistrictIds.filter((id) => id !== selectedDistrict!.id);
    const nearbyRowsRaw = otherDistrictIds.length
      ? await prisma.pricingDistrictPriceDaily.findMany({
          where: { canonicalSkuId: sku.id, districtId: { in: otherDistrictIds }, publicDisplayAllowed: true },
          orderBy: { priceDate: "desc" },
          take: 300,
        })
      : [];
    const latestByDistrict = new Map<string, (typeof nearbyRowsRaw)[number]>();
    for (const row of nearbyRowsRaw) {
      if (!latestByDistrict.has(row.districtId)) latestByDistrict.set(row.districtId, row);
    }
    const districtNameById = new Map(allAvailableDistricts.map((d) => [d.id, d]));
    const nearbyDistricts = Array.from(latestByDistrict.values())
      .map((row) => {
        const district = districtNameById.get(row.districtId);
        if (!district) return null;
        return {
          districtCode: district.code,
          districtName: district.name,
          medianPerBaseUnit: Number(row.medianPerBaseUnit),
          minPerBaseUnit: row.minPerBaseUnit !== null ? Number(row.minPerBaseUnit) : null,
          maxPerBaseUnit: row.maxPerBaseUnit !== null ? Number(row.maxPerBaseUnit) : null,
          confidence: row.confidence,
          method: row.method,
          methodLabel: toMethodLabel(row.method),
          priceDate: row.priceDate.toISOString().slice(0, 10),
          diffPct: computeDiffPct(Number(row.medianPerBaseUnit), current.medianPerBaseUnit),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.districtName.localeCompare(b.districtName));

    // ── Step 6: source breakdown (attribution-safe) ──────────────────────
    const contributingSources = currentRow.contributingSourceCodes ?? [];
    let sourceBreakdown: DistrictPricingPanelResponse["sourceBreakdown"] = [];
    if (contributingSources.length > 0) {
      const sourceRows = await prisma.pricingSource.findMany({
        where: { code: { in: contributingSources } },
        select: { tier: true, licenseClass: true, attributionText: true },
      });
      // Never surface an INTERNAL_ONLY source's attribution — publicDisplayAllowed
      // being true on the daily row already guarantees no INTERNAL_ONLY source
      // contributed, but this is a defensive second filter at serialization time.
      const safeSources = sourceRows
        .filter((s) => s.licenseClass !== "INTERNAL_ONLY")
        .map((s) => ({ tier: s.tier, attributionText: s.licenseClass === "ATTRIBUTION_REQUIRED" ? s.attributionText : null }));
      sourceBreakdown = buildSourceBreakdown(safeSources);
    }

    // ── Step 7: market position (server-computed only) ──────────────────
    let marketPosition: DistrictPricingPanelResponse["marketPosition"] = null;
    let marketPositionUnavailableReason: DistrictPricingPanelResponse["marketPositionUnavailableReason"] = null;
    if (current.confidence === "LOW") {
      marketPositionUnavailableReason = "LOW_CONFIDENCE";
    } else if (listingPricePerBaseUnit === null || Number.isNaN(listingPricePerBaseUnit)) {
      marketPositionUnavailableReason = "NO_DATA";
    } else {
      const computed = computeMarketPosition(
        listingPricePerBaseUnit,
        current.medianPerBaseUnit,
        current.p25PerBaseUnit,
        current.p75PerBaseUnit
      );
      marketPosition = computed;
    }

    // ── Step 8: historical purchase context (this builder's own PriceSnapshots) ──
    const previousSnapshot = await prisma.priceSnapshot.findFirst({
      where: { canonicalProductId, source: "ORDER" },
      orderBy: { capturedAt: "desc" },
      select: { price: true, capturedAt: true },
    });
    let historicalPurchase: DistrictPricingPanelResponse["historicalPurchase"] = null;
    if (previousSnapshot && current.medianPerDisplayUnit !== null) {
      const previousPrice = Number(previousSnapshot.price);
      const diffAmount = current.medianPerDisplayUnit - previousPrice;
      historicalPurchase = {
        previousPrice,
        previousDate: previousSnapshot.capturedAt.toISOString().slice(0, 10),
        currentMedianPerDisplayUnit: current.medianPerDisplayUnit,
        diffAmount,
        diffPct: computeDiffPct(current.medianPerDisplayUnit, previousPrice),
      };
    }

    const response: DistrictPricingPanelResponse = {
      resolved: true,
      selectedDistrict: { code: selectedDistrict.code, name: selectedDistrict.name },
      isDistrictFallback,
      availableDistricts: allAvailableDistricts.map((d) => ({ code: d.code, name: d.name })),
      current,
      trend: trend.length > 0 ? trend : [],
      nearbyDistricts,
      sourceBreakdown,
      marketPosition,
      marketPositionUnavailableReason,
      historicalPurchase,
    };

    if (trend.length === 0) {
      response.emptyReason = undefined; // trend absence is not a hard empty-state — panel shows "no trend" locally
    }

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("District pricing panel GET error:", error);
    return NextResponse.json({ error: "Failed to fetch district pricing" }, { status: 500 });
  }
}
