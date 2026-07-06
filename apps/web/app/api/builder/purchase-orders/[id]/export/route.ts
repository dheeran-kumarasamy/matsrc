import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { serializePurchaseOrder, purchaseOrderInclude } from "@/lib/purchase-order-utils";

export const dynamic = "force-dynamic";

// GET /api/builder/purchase-orders/[id]/export
// Auto-generates a downloadable JSON representation of the PO for record-keeping.
// Kept async/on-demand (only computed when requested) so it never blocks the approval flow.
// ?format=pdf returns a simple print-ready HTML document the browser can "Save as PDF" —
// this still requires zero manual upload/print/scan steps in the core PO flow.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, builderId: user.id },
      include: purchaseOrderInclude,
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    const payload = {
      documentType: "PURCHASE_ORDER",
      generatedAt: new Date().toISOString(),
      ...serializePurchaseOrder(po),
    };

    const url = new URL(request.url);
    const format = url.searchParams.get("format");

    if (format === "pdf") {
      const html = renderPoHtml(payload);
      return new NextResponse(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="${payload.poNumber}.html"`,
        },
      });
    }

    return NextResponse.json(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="${payload.poNumber}.json"`,
      },
    });
  } catch (error) {
    console.error("Purchase order export error:", error);
    return NextResponse.json({ error: "Failed to export purchase order" }, { status: 500 });
  }
}

function renderPoHtml(po: any): string {
  const rows = po.lineItems
    .map(
      (li: any) => `
      <tr>
        <td>${escapeHtml(li.productName)}</td>
        <td style="text-align:right">${li.quantity} ${escapeHtml(li.unit ?? "")}</td>
        <td style="text-align:right">INR ${Number(li.unitPrice).toLocaleString("en-IN")}</td>
        <td style="text-align:right">INR ${Number(li.tax).toLocaleString("en-IN")}</td>
        <td>${li.deliveryDate ? new Date(li.deliveryDate).toLocaleDateString("en-IN") : "TBD"}</td>
        <td style="text-align:right">INR ${Number(li.lineTotal).toLocaleString("en-IN")}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(po.poNumber)}</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; color: #1e293b; padding: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 10px; font-size: 13px; }
  th { background: #f8fafc; text-align: left; }
  .total { text-align: right; font-weight: 700; margin-top: 12px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-size: 12px; font-weight: 600; }
</style>
</head>
<body>
  <h1>Purchase Order ${escapeHtml(po.poNumber)}</h1>
  <p class="meta">
    Status: <span class="badge">${escapeHtml(po.status)}</span> · Version ${po.version} ·
    Generated ${new Date(po.generatedAt).toLocaleString("en-IN")}
  </p>
  <p class="meta">
    Buyer: ${escapeHtml(po.builder?.name ?? po.builder?.email ?? "Builder")}<br/>
    Supplier: ${escapeHtml(po.supplier?.companyName ?? "Supplier")}<br/>
    Enquiry/Order ref: ${escapeHtml(po.orderId)}<br/>
    ${po.approvedAt ? `Approved: ${new Date(po.approvedAt).toLocaleString("en-IN")} by ${escapeHtml(po.approvedBy ?? "")}` : "Awaiting approval"}
  </p>
  <table>
    <thead>
      <tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Tax</th><th>Delivery</th><th>Line Total</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="total">Total: INR ${Number(po.total).toLocaleString("en-IN")}</p>
  ${po.notes ? `<p class="meta">Notes: ${escapeHtml(po.notes)}</p>` : ""}
</body>
</html>`;
}

function escapeHtml(value: string): string {
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
