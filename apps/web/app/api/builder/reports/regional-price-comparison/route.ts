import { NextResponse } from "next/server";
import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getRegionalPriceComparisonRows } from "@/lib/reports-data";

export const dynamic = "force-dynamic";

// Regional Price Comparison: for canonical products the builder has ordered
// before, compares average prices for that same material across regions.
//
// Data sources (merged, deduplicated by supplierId per canonical product):
//
// 1. PriceSnapshot time-series (primary) — append-only rows written each time
//    a supplier creates or reprices a listing. Rows carry PriceSnapshot.region
//    which is copied from SupplierProfile.region at write time. Historically
//    this field was NULL for all existing rows because SupplierProfile.region
//    had no UI entry point until now, so the snapshot source alone returned
//    empty results.
//
// 2. Live listings feed (fallback / supplement) — the same public feed used
//    by the Live Market Prices report. For each active listing we resolve the
//    supplier's current region from SupplierProfile.region. This means the
//    report shows data as soon as suppliers fill in their region in their
//    profile, without waiting for a new price event to be recorded.
//
// Both sources are merged into one regionMap per canonical product. The live
// feed contributes at most one price point per supplier (current basePrice),
// while PriceSnapshots contribute every historical price event (up to 365).
// Aggregation logic lives in @/lib/reports-data so the XLSX/PDF export route
// (app/api/builder/reports/[reportId]/export) computes identical rows.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const rows = await getRegionalPriceComparisonRows(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Regional price comparison report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
