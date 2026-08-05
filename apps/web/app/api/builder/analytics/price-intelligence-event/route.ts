import { NextResponse } from "next/server";
import { prisma, getUserCtx } from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// Phase 6A: minimal, additive analytics sink for the District Price
// Intelligence panel. Reuses the existing generic AuditLog model rather
// than introducing a new analytics library or Prisma model — no schema
// change required. Fire-and-forget from the client (lib/interest-events.ts
// recordPriceIntelligenceEvent); failures here must never surface to the
// user, so this endpoint intentionally still returns 200 on internal
// errors after logging server-side (matches the "never block UX for
// tracking" convention already used by /interest-event).
const ALLOWED_EVENT_TYPES = new Set([
  "PANEL_OPENED",
  "DISTRICT_CHANGED",
  "COMPARISON_VIEWED",
  "CSV_DOWNLOADED",
  "TREND_RANGE_CHANGED",
  "QUOTE_REQUESTED",
]);

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const body = await request.json();
    const { canonicalProductId, eventType, metadata } = body ?? {};

    if (!canonicalProductId || !ALLOWED_EVENT_TYPES.has(eventType)) {
      return NextResponse.json({ error: "Invalid event payload" }, { status: 400 });
    }

    await prisma.auditLog.create({
      data: {
        actorId: ctx.userId,
        action: `PRICE_INTELLIGENCE_${eventType}`,
        entityType: "CanonicalProduct",
        entityId: canonicalProductId,
        metadata: metadata ?? {},
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Price intelligence event tracking error:", error);
    // Tracking must never break the UX — swallow to 200.
    return NextResponse.json({ ok: false });
  }
}
