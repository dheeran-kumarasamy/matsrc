import { NextResponse } from "next/server";
import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getLiveMarketPriceRows } from "@/lib/reports-data";

export const dynamic = "force-dynamic";

// Live Market Prices: for canonical products the builder has ordered before,
// shows every currently active supplier's price for that same material,
// sourced from the live public listings feed (same canonical-key scoping
// pattern as Best Supplier Pricing) — real, queryable data, no new model
// required. Supplier display names are resolved via a direct Prisma lookup
// since the public listings feed does not carry a supplier display name.
//
// By default (LIVE_MARKET_PRICES_SHOW_SUPPLIER_NAMES unset/false — see
// @/lib/report-flags) supplier identities are NOT sent to the client: only
// the lowest and highest rate for each material are returned, labelled
// generically ("Lowest"/"Highest") instead of by supplier name. Set
// LIVE_MARKET_PRICES_SHOW_SUPPLIER_NAMES="true" to restore the full
// per-supplier breakdown.
// Aggregation logic lives in @/lib/reports-data so the XLSX/PDF export route
// (app/api/builder/reports/[reportId]/export) computes identical rows.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const rows = await getLiveMarketPriceRows(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Live market prices report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
