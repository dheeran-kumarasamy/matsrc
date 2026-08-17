import { NextResponse } from "next/server";
import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getDistrictPriceIntelligenceRows } from "@/lib/reports-data";

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
// Aggregation logic lives in @/lib/reports-data so the XLSX/PDF export route
// (app/api/builder/reports/[reportId]/export) computes identical rows.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const rows = await getDistrictPriceIntelligenceRows(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("District price intelligence report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
