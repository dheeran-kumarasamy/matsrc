import { NextResponse } from "next/server";
import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getSiteWiseReportData, paginateRows } from "@/lib/site-wise-report";
import type { SiteWiseReportResponse } from "@/lib/reports-types";

export const dynamic = "force-dynamic";

// GET /api/builder/reports/site-wise
// Builder-only, per-site (or "all sites"/"unassigned") purchase report.
// Never statically cached — financial data, force-dynamic + no-store client fetch.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const url = new URL(request.url);
    const siteId = url.searchParams.get("siteId") ?? "all";
    const dateFrom = url.searchParams.get("dateFrom") ?? undefined;
    const dateTo = url.searchParams.get("dateTo") ?? undefined;
    const supplierId = url.searchParams.get("supplierId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const categoryId = url.searchParams.get("categoryId") ?? undefined;
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? "25") || 25));

    const filters = { siteId, dateFrom, dateTo, supplierId, status, categoryId, page, pageSize };

    const { summary, options, allRows } = await getSiteWiseReportData(user.id, filters);

    const response: SiteWiseReportResponse = {
      filters,
      summary,
      options,
      detail: {
        rows: paginateRows(allRows, page, pageSize),
        page,
        pageSize,
        totalRows: allRows.length,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Site-wise report error:", error);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }
}
