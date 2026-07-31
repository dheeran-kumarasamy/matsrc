import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

const DEFAULTS = {
  purchaseLedger: "Purchase Account",
  cgstLedger: "CGST",
  sgstLedger: "SGST",
  igstLedger: "IGST",
  roundOffLedger: "Round Off",
};

// GET /api/builder/tally/ledger-mapping
// Returns the builder's Tally ledger mapping config, creating a sensible
// default row (empty supplier map, blank company name) on first access so
// the settings UI always has something to render/edit.
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    let mapping = await prisma.tallyLedgerMapping.findUnique({ where: { builderId: user.id } });
    if (!mapping) {
      mapping = await prisma.tallyLedgerMapping.create({
        data: {
          builderId: user.id,
          companyName: user.name ? `${user.name}` : "My Company",
          ...DEFAULTS,
          supplierLedgerMap: {},
        },
      });
    }

    // Also return the builder's suppliers (from order history) so the UI
    // can render a per-supplier ledger-name mapping form.
    const suppliers = await prisma.supplierProfile.findMany({
      where: { orderItems: { some: { order: { userId: user.id } } } },
      select: { id: true, companyName: true },
      orderBy: { companyName: "asc" },
    });

    return NextResponse.json({
      id: mapping.id,
      companyName: mapping.companyName,
      purchaseLedger: mapping.purchaseLedger,
      cgstLedger: mapping.cgstLedger,
      sgstLedger: mapping.sgstLedger,
      igstLedger: mapping.igstLedger,
      roundOffLedger: mapping.roundOffLedger,
      supplierLedgerMap: mapping.supplierLedgerMap,
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.companyName })),
    });
  } catch (error) {
    console.error("Tally ledger mapping GET error:", error);
    return NextResponse.json({ error: "Failed to load Tally settings" }, { status: 500 });
  }
}

// PATCH /api/builder/tally/ledger-mapping
// Partial update — any subset of companyName/purchaseLedger/cgstLedger/
// sgstLedger/igstLedger/roundOffLedger/supplierLedgerMap. Builder-scoped
// (per-builder data, never a global env config).
export async function PATCH(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    const data: any = {};
    for (const key of [
      "companyName",
      "purchaseLedger",
      "cgstLedger",
      "sgstLedger",
      "igstLedger",
      "roundOffLedger",
    ] as const) {
      if (typeof body[key] === "string" && body[key].trim()) {
        data[key] = body[key].trim();
      }
    }
    if (body.supplierLedgerMap && typeof body.supplierLedgerMap === "object") {
      data.supplierLedgerMap = body.supplierLedgerMap;
    }

    const mapping = await prisma.tallyLedgerMapping.upsert({
      where: { builderId: user.id },
      update: data,
      create: {
        builderId: user.id,
        companyName: data.companyName ?? (user.name ? `${user.name}` : "My Company"),
        purchaseLedger: data.purchaseLedger ?? DEFAULTS.purchaseLedger,
        cgstLedger: data.cgstLedger ?? DEFAULTS.cgstLedger,
        sgstLedger: data.sgstLedger ?? DEFAULTS.sgstLedger,
        igstLedger: data.igstLedger ?? DEFAULTS.igstLedger,
        roundOffLedger: data.roundOffLedger ?? DEFAULTS.roundOffLedger,
        supplierLedgerMap: data.supplierLedgerMap ?? {},
      },
    });

    return NextResponse.json({
      id: mapping.id,
      companyName: mapping.companyName,
      purchaseLedger: mapping.purchaseLedger,
      cgstLedger: mapping.cgstLedger,
      sgstLedger: mapping.sgstLedger,
      igstLedger: mapping.igstLedger,
      roundOffLedger: mapping.roundOffLedger,
      supplierLedgerMap: mapping.supplierLedgerMap,
    });
  } catch (error) {
    console.error("Tally ledger mapping PATCH error:", error);
    return NextResponse.json({ error: "Failed to update Tally settings" }, { status: 500 });
  }
}
