import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { buildVouchersForBuilder } from "@/lib/tally-vouchers";
import { validateVouchers } from "@/lib/tally-xml";

export const dynamic = "force-dynamic";

// GET /api/builder/tally/dry-run
// Validation/preview pass: returns voucher count, total value, and any
// blockers (e.g. unmapped suppliers) WITHOUT generating the XML file, so
// the UI can surface issues before the builder attempts the real download.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const url = new URL(request.url);
    const siteId = url.searchParams.get("siteId") ?? "all";
    const dateFrom = url.searchParams.get("dateFrom") ?? undefined;
    const dateTo = url.searchParams.get("dateTo") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;

    const vouchers = await buildVouchersForBuilder(user.id, { siteId, dateFrom, dateTo, status });

    const mapping = await prisma.tallyLedgerMapping.findUnique({ where: { builderId: user.id } });
    const supplierLedgerMap = (mapping?.supplierLedgerMap as Record<string, string>) ?? {};

    const result = validateVouchers(vouchers, {
      companyName: mapping?.companyName ?? "My Company",
      purchaseLedger: mapping?.purchaseLedger ?? "Purchase Account",
      cgstLedger: mapping?.cgstLedger ?? "CGST",
      sgstLedger: mapping?.sgstLedger ?? "SGST",
      igstLedger: mapping?.igstLedger ?? "IGST",
      roundOffLedger: mapping?.roundOffLedger ?? "Round Off",
      supplierLedgerMap,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Tally dry-run error:", error);
    return NextResponse.json({ error: "Failed to validate Tally export" }, { status: 500 });
  }
}
