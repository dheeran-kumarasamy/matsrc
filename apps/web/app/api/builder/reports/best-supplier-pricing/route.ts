import { NextResponse } from "next/server";
import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getBestSupplierPricingRows } from "@/lib/reports-data";

export const dynamic = "force-dynamic";

// Best Supplier Pricing: for canonical products the builder has ordered
// before, shows every currently active supplier's price for that same
// material side-by-side, flagging the cheapest. Uses the existing
// cross-supplier canonical-product grouping plus the live public listings
// feed already used by the products/checkout flows — real, queryable data,
// no new model required.
//
// Aggregation logic lives in @/lib/reports-data so the XLSX/PDF export route
// (app/api/builder/reports/[reportId]/export) computes identical rows.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const rows = await getBestSupplierPricingRows(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Best supplier pricing report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
