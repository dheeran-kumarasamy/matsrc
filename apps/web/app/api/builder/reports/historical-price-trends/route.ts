import { NextResponse } from "next/server";
import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getHistoricalPriceTrendRows } from "@/lib/reports-data";

export const dynamic = "force-dynamic";

// Historical Price Trends: for canonical products the builder has ordered
// before, shows average price movement over time (by month), sourced from
// the PriceSnapshot append-only price time series. Uses CanonicalProduct.id
// (not canonicalKey) since PriceSnapshot.canonicalProductId is the real FK.
// Note: this replaces the legacy/dead `PricePoint` model (never written to
// anywhere in the codebase) which was the original reason this report was
// gated unavailable.
// Aggregation logic lives in @/lib/reports-data so the XLSX/PDF export route
// (app/api/builder/reports/[reportId]/export) computes identical rows.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const rows = await getHistoricalPriceTrendRows(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Historical price trends report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
