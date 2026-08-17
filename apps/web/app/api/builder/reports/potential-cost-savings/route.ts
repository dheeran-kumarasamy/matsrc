import { NextResponse } from "next/server";
import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getCostSavingsSummary } from "@/lib/reports-data";

export const dynamic = "force-dynamic";

// Potential Cost Savings: derived report combining Material Consumption
// (what/how much the builder has ordered) with Best Supplier Pricing
// (current cross-supplier prices for the same canonical product). For each
// past order line, compares the price actually paid against the cheapest
// price currently available for that material and sums the gap. Purely
// computed from the two other real reports' data sources — no new model.
// Aggregation logic lives in @/lib/reports-data so the XLSX/PDF export route
// (app/api/builder/reports/[reportId]/export) computes identical rows.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const summary = await getCostSavingsSummary(user.id);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Cost savings report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
