import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getOrCreateBuilder, resolveUserCtx } from "@/lib/builder-db";
import { getSiteWiseReportData } from "@/lib/site-wise-report";
import type { SiteWiseReportFilters } from "@/lib/reports-types";

export const dynamic = "force-dynamic";

function readFilters(url: URL): SiteWiseReportFilters {
  return {
    siteId: url.searchParams.get("siteId") ?? "all",
    dateFrom: url.searchParams.get("dateFrom") ?? undefined,
    dateTo: url.searchParams.get("dateTo") ?? undefined,
    supplierId: url.searchParams.get("supplierId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    categoryId: url.searchParams.get("categoryId") ?? undefined,
  };
}

function escapeCsv(value: string | number): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

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

// GET /api/builder/reports/site-wise/export?format=csv|xlsx|pdf
// Builder-only. Same filters as the report API. Always computed server-side
// from the shared getSiteWiseReportData aggregation logic (no client totals).
export async function GET(request: Request) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
    const filters = readFilters(url);

    const { summary, allRows } = await getSiteWiseReportData(user.id, filters);
    const generatedAt = new Date().toISOString();
    const filenameBase = `site-wise-report-${generatedAt.slice(0, 10)}`;

    if (format === "csv") {
      const header = [
        "Order ID",
        "Date",
        "Status",
        "Site",
        "Supplier",
        "Item",
        "Qty",
        "Unit",
        "Unit Price",
        "Taxable Value",
        "Tax %",
        "GST Amount",
        "Total",
      ];
      const lines = [header.join(",")];
      for (const row of allRows) {
        lines.push(
          [
            escapeCsv(row.orderId),
            escapeCsv(row.orderDateLabel),
            escapeCsv(row.status),
            escapeCsv(row.siteName),
            escapeCsv(row.supplierName),
            escapeCsv(row.productName),
            escapeCsv(row.quantity),
            escapeCsv(row.unit),
            escapeCsv(row.unitPrice.toFixed(2)),
            escapeCsv(row.taxableValue.toFixed(2)),
            escapeCsv(row.taxRatePercent.toFixed(2)),
            escapeCsv(row.gstAmount.toFixed(2)),
            escapeCsv(row.total.toFixed(2)),
          ].join(",")
        );
      }
      lines.push("");
      lines.push(`Total Spend,,,,,,,,,,,,${summary.totalSpend.toFixed(2)}`);

      return new NextResponse(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
        },
      });
    }

    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Buildohub";
      workbook.created = new Date();

      const summarySheet = workbook.addWorksheet("Summary");
      summarySheet.addRow(["Site-wise Purchase Report"]);
      summarySheet.addRow(["Generated", generatedAt]);
      summarySheet.addRow([]);
      summarySheet.addRow(["Total Spend", summary.totalSpend.toFixed(2)]);
      summarySheet.addRow(["Order Count", summary.orderCount]);
      summarySheet.addRow(["Item Count", summary.itemCount]);
      summarySheet.addRow([]);
      summarySheet.addRow(["Spend by Supplier"]);
      summarySheet.addRow(["Supplier", "Spend"]);
      for (const s of summary.spendBySupplier) {
        summarySheet.addRow([s.supplierName, s.spend.toFixed(2)]);
      }
      summarySheet.addRow([]);
      summarySheet.addRow(["Spend by Site"]);
      summarySheet.addRow(["Site", "Spend", "Order Count"]);
      for (const s of summary.spendBySite) {
        summarySheet.addRow([s.siteName, s.spend.toFixed(2), s.orderCount]);
      }
      summarySheet.addRow([]);
      summarySheet.addRow(["Spend Over Time"]);
      summarySheet.addRow(["Month", "Spend"]);
      for (const s of summary.spendOverTime) {
        summarySheet.addRow([s.month, s.spend.toFixed(2)]);
      }
      summarySheet.getColumn(1).width = 28;
      summarySheet.getColumn(2).width = 18;

      const detailSheet = workbook.addWorksheet("Detail");
      detailSheet.addRow([
        "Order ID",
        "Date",
        "Status",
        "Site",
        "Supplier",
        "Item",
        "Qty",
        "Unit",
        "Unit Price",
        "Taxable Value",
        "Tax %",
        "GST Amount",
        "Total",
      ]);
      detailSheet.getRow(1).font = { bold: true };
      for (const row of allRows) {
        detailSheet.addRow([
          row.orderId,
          row.orderDateLabel,
          row.status,
          row.siteName,
          row.supplierName,
          row.productName,
          row.quantity,
          row.unit,
          Number(row.unitPrice.toFixed(2)),
          Number(row.taxableValue.toFixed(2)),
          Number(row.taxRatePercent.toFixed(2)),
          Number(row.gstAmount.toFixed(2)),
          Number(row.total.toFixed(2)),
        ]);
      }
      detailSheet.columns.forEach((col) => {
        col.width = 18;
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
      const rows = allRows
        .map(
          (row) => `
        <tr>
          <td>${escapeHtml(row.orderId)}</td>
          <td>${escapeHtml(row.orderDateLabel)}</td>
          <td>${escapeHtml(row.siteName)}</td>
          <td>${escapeHtml(row.supplierName)}</td>
          <td>${escapeHtml(row.productName)}</td>
          <td style="text-align:right">${row.quantity} ${escapeHtml(row.unit)}</td>
          <td style="text-align:right">INR ${row.unitPrice.toLocaleString("en-IN")}</td>
          <td style="text-align:right">INR ${row.taxableValue.toLocaleString("en-IN")}</td>
          <td style="text-align:right">${row.taxRatePercent}%</td>
          <td style="text-align:right">INR ${row.gstAmount.toLocaleString("en-IN")}</td>
          <td style="text-align:right">INR ${row.total.toLocaleString("en-IN")}</td>
        </tr>`
        )
        .join("");

      const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Site-wise Purchase Report</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; color: #1e293b; padding: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; font-size: 11px; }
  th { background: #f8fafc; text-align: left; }
  .total { text-align: right; font-weight: 700; margin-top: 12px; font-size: 14px; }
</style>
</head>
<body>
  <h1>Site-wise Purchase Report</h1>
  <p class="meta">Generated ${new Date(generatedAt).toLocaleString("en-IN")}</p>
  <p class="meta">
    Total Spend: INR ${summary.totalSpend.toLocaleString("en-IN")} ·
    Orders: ${summary.orderCount} · Items: ${summary.itemCount}
  </p>
  <table>
    <thead>
      <tr>
        <th>Order</th><th>Date</th><th>Site</th><th>Supplier</th><th>Item</th>
        <th>Qty</th><th>Unit Price</th><th>Taxable</th><th>Tax</th><th>GST</th><th>Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="total">Total: INR ${summary.totalSpend.toLocaleString("en-IN")}</p>
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
    console.error("Site-wise report export error:", error);
    return NextResponse.json({ error: "Failed to export report" }, { status: 500 });
  }
}
