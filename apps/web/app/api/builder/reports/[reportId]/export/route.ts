import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { resolveUserCtx, getOrCreateBuilder } from "@/lib/builder-db";
import {
  getMaterialConsumptionRows,
  getBestSupplierPricingRows,
  getCostSavingsSummary,
  getLiveMarketPriceRows,
  getRegionalPriceComparisonRows,
  getHistoricalPriceTrendRows,
  getDistrictPriceIntelligenceRows,
} from "@/lib/reports-data";
import { REPORT_DEFINITIONS } from "@/lib/reports-definitions";

export const dynamic = "force-dynamic";

// GET /api/builder/reports/[reportId]/export?format=xlsx|pdf
//
// Shared XLSX/PDF export endpoint for every report shown in the /reports
// overlay (Material Consumption, Best Supplier Pricing, Potential Cost
// Savings, Live Market Prices, Regional Price Comparison, Historical Price
// Trends, District-Wise Price Intelligence). Reuses the exact same
// aggregation functions the on-screen JSON API route calls (@/lib/reports-data)
// so the exported file always matches what's rendered in the overlay.
//
// GATING: if the report has zero rows, this returns 400 instead of a file —
// no blank/empty report should ever be downloadable. The UI (ReportResult /
// ReportsExplorer) also only shows the download buttons once data has loaded
// AND has at least one row, so this is a defense-in-depth check.

function escapeHtml(value: string | number): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

type ExportTable = {
  title: string;
  headers: string[];
  rows: (string | number)[][];
};

async function buildExportTable(reportId: string, builderId: string): Promise<ExportTable | null> {
  switch (reportId) {
    case "material-consumption": {
      const rows = await getMaterialConsumptionRows(builderId);
      if (rows.length === 0) return null;
      return {
        title: "Material Consumption Report",
        headers: ["Material", "Category", "Qty Ordered", "Unit", "Orders", "Last Ordered"],
        rows: rows.map((r) => [
          r.name,
          r.category,
          r.totalQuantity,
          r.unit,
          r.orderCount,
          new Date(r.lastOrderedAt).toLocaleDateString("en-IN"),
        ]),
      };
    }
    case "best-supplier-pricing": {
      const rows = await getBestSupplierPricingRows(builderId);
      if (rows.length === 0) return null;
      const table: ExportTable = {
        title: "Best Supplier Pricing",
        headers: ["Material", "Unit", "Supplier #", "Price", "Cheapest?"],
        rows: [],
      };
      for (const row of rows) {
        row.options.forEach((option, index) => {
          table.rows.push([
            index === 0 ? row.name : "",
            index === 0 ? row.unit : "",
            `Supplier ${index + 1}`,
            option.price,
            option.isCheapest ? "Yes" : "",
          ]);
        });
      }
      return table;
    }
    case "potential-cost-savings": {
      const summary = await getCostSavingsSummary(builderId);
      if (summary.rows.length === 0) return null;
      return {
        title: `Potential Cost Savings (Total: ₹${summary.totalPotentialSavings.toLocaleString("en-IN")})`,
        headers: ["Material", "Unit", "Qty Ordered", "Amount Paid", "Best Available", "Potential Savings"],
        rows: summary.rows.map((r) => [
          r.name,
          r.unit,
          r.quantityOrdered,
          Number(r.amountPaid.toFixed(2)),
          Number((r.currentBestUnitPrice * r.quantityOrdered).toFixed(2)),
          Number(r.potentialSavings.toFixed(2)),
        ]),
      };
    }
    case "live-market-prices": {
      const rows = await getLiveMarketPriceRows(builderId);
      if (rows.length === 0) return null;
      const table: ExportTable = {
        title: "Live Market Prices",
        headers: ["Material", "Unit", "Offer", "Price"],
        rows: [],
      };
      for (const row of rows) {
        row.offers.forEach((offer, index) => {
          table.rows.push([
            index === 0 ? row.name : "",
            index === 0 ? row.unit : "",
            offer.supplierName ?? offer.label ?? "",
            offer.price,
          ]);
        });
      }
      return table;
    }
    case "regional-price-comparison": {
      const rows = await getRegionalPriceComparisonRows(builderId);
      if (rows.length === 0) return null;
      const table: ExportTable = {
        title: "Regional Price Comparison",
        headers: ["Material", "Unit", "Region", "Average Price", "Sample Size"],
        rows: [],
      };
      for (const row of rows) {
        row.regions.forEach((region, index) => {
          table.rows.push([
            index === 0 ? row.name : "",
            index === 0 ? row.unit : "",
            region.region,
            Number(region.averagePrice.toFixed(2)),
            region.sampleSize,
          ]);
        });
      }
      return table;
    }
    case "historical-price-trends": {
      const rows = await getHistoricalPriceTrendRows(builderId);
      if (rows.length === 0) return null;
      const table: ExportTable = {
        title: "Historical Price Trends",
        headers: ["Material", "Unit", "Period", "Average Price", "Sample Size"],
        rows: [],
      };
      for (const row of rows) {
        row.points.forEach((point, index) => {
          table.rows.push([
            index === 0 ? row.name : "",
            index === 0 ? row.unit : "",
            point.period,
            Number(point.averagePrice.toFixed(2)),
            point.sampleSize,
          ]);
        });
      }
      return table;
    }
    case "district-price-intelligence": {
      const rows = await getDistrictPriceIntelligenceRows(builderId);
      if (rows.length === 0) return null;
      return {
        title: "District-Wise Price Intelligence",
        headers: ["Material", "District", "Base Unit", "Median Price", "Min", "Max", "Confidence", "As Of"],
        rows: rows.map((r) => [
          r.materialName,
          r.districtName,
          r.baseUnit,
          Number(r.medianPerBaseUnit.toFixed(2)),
          r.minPerBaseUnit !== null ? Number(r.minPerBaseUnit.toFixed(2)) : "",
          r.maxPerBaseUnit !== null ? Number(r.maxPerBaseUnit.toFixed(2)) : "",
          r.confidence,
          new Date(r.latestPriceDate).toLocaleDateString("en-IN"),
        ]),
      };
    }
    default:
      return null;
  }
}

export async function GET(request: Request, { params }: { params: { reportId: string } }) {
  try {
    const reportId = params.reportId;
    const known = REPORT_DEFINITIONS.some((r) => r.id === reportId);
    if (!known) {
      return NextResponse.json({ error: "Unknown report" }, { status: 404 });
    }

    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase();

    const table = await buildExportTable(reportId, user.id);

    // No blank report should ever be downloadable — if there are no records,
    // reject the export outright instead of returning an empty file.
    if (!table || table.rows.length === 0) {
      return NextResponse.json(
        { error: "This report has no records to export yet." },
        { status: 400 }
      );
    }

    const generatedAt = new Date();
    const filenameBase = `${reportId}-${generatedAt.toISOString().slice(0, 10)}`;

    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Buildohub";
      workbook.created = generatedAt;

      const sheet = workbook.addWorksheet("Report");
      sheet.addRow([table.title]);
      sheet.addRow([`Generated ${generatedAt.toLocaleString("en-IN")}`]);
      sheet.addRow([]);
      sheet.addRow(table.headers);
      sheet.getRow(4).font = { bold: true };
      for (const row of table.rows) {
        sheet.addRow(row);
      }
      sheet.columns.forEach((col) => {
        col.width = 22;
      });

      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(Buffer.from(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
        },
      });
    }

    if (format === "pdf") {
      const headerRow = table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
      const bodyRows = table.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("");

      const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(table.title)}</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; color: #1e293b; padding: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; font-size: 11px; text-align: left; }
  th { background: #f8fafc; }
</style>
</head>
<body>
  <h1>${escapeHtml(table.title)}</h1>
  <p class="meta">Generated ${generatedAt.toLocaleString("en-IN")}</p>
  <table>
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;

      return new NextResponse(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="${filenameBase}.html"`,
        },
      });
    }

    return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Report export error:", error);
    return NextResponse.json({ error: "Failed to export report" }, { status: 500 });
  }
}
