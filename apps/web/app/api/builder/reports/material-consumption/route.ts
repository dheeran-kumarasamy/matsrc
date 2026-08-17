import { NextResponse } from "next/server";
import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getMaterialConsumptionRows } from "@/lib/reports-data";

export const dynamic = "force-dynamic";

// Material Consumption Report: aggregates the builder's own OrderItem history
// by product — total quantity ordered, number of orders it appeared in, and
// the most recent order date. Real, queryable data (Order/OrderItem tables),
// no dependency on any external/live service.
//
// Aggregation logic lives in @/lib/reports-data so the XLSX/PDF export route
// (app/api/builder/reports/[reportId]/export) computes identical rows.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const rows = await getMaterialConsumptionRows(user.id);
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Material consumption report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
