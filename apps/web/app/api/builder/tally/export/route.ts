import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, resolveUserCtx } from "@/lib/builder-db";
import { buildVouchersForBuilder } from "@/lib/tally-vouchers";
import { buildTallyImportXml, validateVouchers } from "@/lib/tally-xml";

export const dynamic = "force-dynamic";

// GET /api/builder/tally/export
// Generates a single .xml file (Tally Purchase Vouchers) for the filtered
// range. Defaults to PAID orders only. Blocks the download (409) if any
// supplier lacks a configured Tally ledger mapping — the dry-run endpoint
// should be called first by the UI to surface this before the user clicks
// download, but this route re-validates regardless as the authoritative check.
export async function GET(request: Request) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const url = new URL(request.url);
    const siteId = url.searchParams.get("siteId") ?? "all";
    const dateFrom = url.searchParams.get("dateFrom") ?? undefined;
    const dateTo = url.searchParams.get("dateTo") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;

    const vouchers = await buildVouchersForBuilder(user.id, { siteId, dateFrom, dateTo, status });

    if (vouchers.length === 0) {
      return NextResponse.json({ error: "No paid orders found for the selected filters" }, { status: 404 });
    }

    const mapping = await prisma.tallyLedgerMapping.findUnique({ where: { builderId: user.id } });
    const supplierLedgerMap = (mapping?.supplierLedgerMap as Record<string, string>) ?? {};

    const mappingConfig = {
      companyName: mapping?.companyName ?? "My Company",
      purchaseLedger: mapping?.purchaseLedger ?? "Purchase Account",
      cgstLedger: mapping?.cgstLedger ?? "CGST",
      sgstLedger: mapping?.sgstLedger ?? "SGST",
      igstLedger: mapping?.igstLedger ?? "IGST",
      roundOffLedger: mapping?.roundOffLedger ?? "Round Off",
      supplierLedgerMap,
    };

    const validation = validateVouchers(vouchers, mappingConfig);
    if (validation.blockers.length > 0) {
      return NextResponse.json(
        { error: "Some suppliers are not mapped to a Tally ledger", blockers: validation.blockers },
        { status: 409 }
      );
    }

    const xml = buildTallyImportXml(vouchers, mappingConfig);

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "TALLY_EXPORT",
        entityType: "Order",
        entityId: vouchers.map((v) => v.orderId).join(","),
        metadata: { voucherCount: vouchers.length, siteId, dateFrom, dateTo, status: status ?? "PAID" },
      },
    });

    const filenameBase = `tally-export-${new Date().toISOString().slice(0, 10)}`;

    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.xml"`,
      },
    });
  } catch (error) {
    console.error("Tally export error:", error);
    return NextResponse.json({ error: "Failed to generate Tally export" }, { status: 500 });
  }
}
