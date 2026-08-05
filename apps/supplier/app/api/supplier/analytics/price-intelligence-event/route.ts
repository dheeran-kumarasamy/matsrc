import { NextResponse } from "next/server";
import { prisma } from "@matsrc/db";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

// Phase 6B — minimal, additive analytics sink for the Supplier "Market
// Intelligence" surfaces (spec §17). Mirrors apps/web's
// analytics/price-intelligence-event route: reuses the existing generic
// AuditLog model, no schema change required. Fire-and-forget from the
// client; failures never surface to the user (still returns 200 after
// logging server-side).
const ALLOWED_EVENTS = new Set([
  "supplier_price_intel_dashboard_viewed",
  "supplier_price_intel_competitiveness_viewed",
  "supplier_price_intel_opportunity_viewed",
  "supplier_price_intel_category_trend_viewed",
  "supplier_price_intel_district_changed",
  "supplier_price_intel_category_changed",
  "supplier_price_intel_csv_export",
  "supplier_price_intel_rfq_assist_opened",
]);

export async function POST(request: Request) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { event, ...metadata } = body ?? {};

    if (!ALLOWED_EVENTS.has(event)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user?.id) {
      // Should not happen since auth() already gates on a valid session, but
      // guard defensively rather than passing a null actorId into AuditLog
      // (actorId is a required, non-nullable column).
      return NextResponse.json({ ok: true });
    }

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: event,
        entityType: "SupplierMarketIntelligence",
        entityId: user.id,
        metadata: metadata ?? {},
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Supplier price intelligence event tracking error:", error);
    // Tracking must never break the UX — swallow to 200.
    return NextResponse.json({ ok: false });
  }
}
