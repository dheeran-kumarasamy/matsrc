import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import type { DistrictPriceIntelligenceRow, DistrictPriceTrendPoint } from "@/lib/reports-types";

export const dynamic = "force-dynamic";

// District-Wise Price Intelligence Report: surfaces the Apify-scraped,
// district-level price intelligence serving layer (PricingDistrictPriceDaily
// + PricingTrendMonthly) directly via Prisma — a separate data source from
// the legacy PriceSnapshot-backed Basic Reports. Only rows explicitly marked
// publicDisplayAllowed are ever surfaced here (same gating rule enforced by
// the NestJS PublicPricingController for the standalone Price Intelligence
// API). Scoped to districts matching the builder's registered site cities
// where a match exists; otherwise falls back to all districts with public
// data, so the report is never empty just because no site city matched.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const sites = await prisma.site.findMany({
      where: { builderId: user.id },
      select: { city: true },
    });
    const siteCities = Array.from(
      new Set(sites.map((s) => s.city).filter((c): c is string => Boolean(c && c.trim())))
    );

    let districts = siteCities.length
      ? await prisma.pricingDistrict.findMany({
          where: { name: { in: siteCities, mode: "insensitive" } },
        })
      : [];

    if (districts.length === 0) {
      // Fallback: no site-city match — show all districts that currently
      // have at least one publicly-displayable daily price row.
      // Phase 6F: this report is district-scoped by design (title:
      // "District-Wise Price Intelligence") — only DISTRICT-level rows
      // participate; a STATE/NATIONAL reference row (districtId=null) is
      // out of scope here rather than silently mapped onto a district.
      const districtIds = await prisma.pricingDistrictPriceDaily.findMany({
        where: { geographyLevel: "DISTRICT", publicDisplayAllowed: true },
        distinct: ["districtId"],
        select: { districtId: true },
        take: 10,
      });
      const nonNullDistrictIds = districtIds.map((d) => d.districtId).filter((id): id is string => id !== null);
      districts = nonNullDistrictIds.length
        ? await prisma.pricingDistrict.findMany({
            where: { id: { in: nonNullDistrictIds } },
          })
        : [];
    }

    if (districts.length === 0) {
      return NextResponse.json([]);
    }

    const districtIds = districts.map((d) => d.id);
    const districtById = new Map(districts.map((d) => [d.id, d]));

    // Latest publicly-displayable daily price per (canonicalSku, district),
    // capped to a reasonable number of SKUs to keep the report readable.
    const latestDaily = await prisma.pricingDistrictPriceDaily.findMany({
      where: { geographyLevel: "DISTRICT", districtId: { in: districtIds }, publicDisplayAllowed: true },
      orderBy: { priceDate: "desc" },
      take: 500,
      include: {
        canonicalSku: {
          select: { id: true, code: true, materialCategory: { select: { name: true } } },
        },
      },
    });

    // Keep only the most recent row per (canonicalSkuId, districtId).
    const latestByKey = new Map<string, (typeof latestDaily)[number]>();
    for (const row of latestDaily) {
      const key = `${row.canonicalSkuId}:${row.districtId}`;
      if (!latestByKey.has(key)) {
        latestByKey.set(key, row);
      }
    }

    const rows: DistrictPriceIntelligenceRow[] = [];
    for (const row of latestByKey.values()) {
      if (!row.districtId) continue; // DISTRICT-scoped report; a STATE/NATIONAL row here would be a bug upstream
      const district = districtById.get(row.districtId);
      if (!district) continue;

      const trendRows = await prisma.pricingTrendMonthly.findMany({
        where: { canonicalSkuId: row.canonicalSkuId, geographyLevel: "DISTRICT", districtId: row.districtId },
        orderBy: { monthStart: "desc" },
        take: 6,
      });

      const trend: DistrictPriceTrendPoint[] = trendRows.map((t) => ({
        monthStart: t.monthStart.toISOString().slice(0, 10),
        medianPerBaseUnit: Number(t.medianPerBaseUnit),
        momChangePct: t.momChangePct !== null ? Number(t.momChangePct) : null,
        yoyChangePct: t.yoyChangePct !== null ? Number(t.yoyChangePct) : null,
        confidence: t.confidence,
      }));

      rows.push({
        canonicalSkuCode: row.canonicalSku.code,
        materialName: row.canonicalSku.materialCategory?.name ?? row.canonicalSku.code,
        districtCode: district.code,
        districtName: district.name,
        baseUnit: row.baseUnit,
        latestPriceDate: row.priceDate.toISOString().slice(0, 10),
        medianPerBaseUnit: Number(row.medianPerBaseUnit),
        minPerBaseUnit: row.minPerBaseUnit !== null ? Number(row.minPerBaseUnit) : null,
        maxPerBaseUnit: row.maxPerBaseUnit !== null ? Number(row.maxPerBaseUnit) : null,
        medianPerDisplayUnit: row.medianPerDisplayUnit !== null ? Number(row.medianPerDisplayUnit) : null,
        displayUnit: row.displayUnit ?? null,
        confidence: row.confidence,
        method: row.method,
        trend,
      });
    }

    rows.sort((a, b) => a.materialName.localeCompare(b.materialName) || a.districtName.localeCompare(b.districtName));

    return NextResponse.json(rows);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("District price intelligence report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
