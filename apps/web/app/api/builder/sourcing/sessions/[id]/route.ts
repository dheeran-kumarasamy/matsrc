import { NextResponse } from "next/server";

import { getOrCreateBuilder, getUserCtx, prisma } from "@/lib/builder-db";
import { loadGeographyIndex } from "@/lib/sourcing/sourcing-data";
import { getRecommendations, getSession, setSessionSite } from "@/lib/sourcing/session-store";
import { classifyLocality } from "@/lib/sourcing/supplier-search";

export const dynamic = "force-dynamic";

// `get_sourcing_status` — resume a sourcing session (§12 "the user should be
// able to leave and resume a sourcing request").
//
// AUTHORIZATION: getSession() is scoped by userId. A session belonging to
// another customer and a session that does not exist both yield null and
// therefore the SAME 404 — the API never reveals that another customer's
// session exists.

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const session = await getSession(user.id, params.id);
    if (!session) {
      return NextResponse.json({ message: "Sourcing session not found" }, { status: 404 });
    }

    const recommendations = await getRecommendations(user.id, session.id);

    // Fails soft: if the geography lookup is unavailable, locality simply
    // falls back to LOCAL/NON_LOCAL/UNKNOWN (never STATE) — same convention
    // as the rest of the /sourcing pricing-intelligence integrations.
    const geography = await loadGeographyIndex().catch((err) => {
      console.warn(
        "[sourcing] geography index unavailable on session read:",
        err instanceof Error ? err.message : err
      );
      return undefined;
    });

    // Resolve the human-readable site name for display (§7: the selected site
    // must be visible before confirmation) — never re-derive it client-side.
    const site = session.siteId
      ? await prisma.site.findUnique({
          where: { id: session.siteId },
          select: { id: true, name: true, city: true, state: true },
        })
      : null;

    return NextResponse.json({
      id: session.id,
      status: session.status,
      siteId: session.siteId,
      siteName: site?.name ?? null,
      siteLocation: site ? [site.city, site.state].filter(Boolean).join(", ") || null : null,
      requirement: session.requirement,
      conversation: session.conversation,
      candidateProducts: session.candidateProducts,
      candidateSuppliers: session.candidateSuppliers,
      confirmedOrderId: session.confirmedOrderId,
      confirmedAt: session.confirmedAt,
      recommendations: recommendations.map((row) => ({
        id: row.id,
        rank: row.rank,
        supplierId: row.supplierId,
        supplierName: row.supplier.companyName,
        supplierRegion: row.supplier.region,
        // Disclosure only (never re-filters the already-persisted ranking) —
        // derived at read time from the persisted supplier region plus the
        // session's requested delivery location, no schema change required.
        locality: classifyLocality(row.supplier.region, session.requirement.location, geography),
        verifiedBadge: row.supplier.verifiedBadge,
        productId: row.productId,
        score: Number(row.score),
        quantity: row.quantity,
        unit: row.unit,
        // Decimal columns are converted to numbers, preserving null as null —
        // a missing figure must never become 0 on the wire.
        unitMaterialPrice: row.unitMaterialPrice === null ? null : Number(row.unitMaterialPrice),
        materialCost: row.materialCost === null ? null : Number(row.materialCost),
        freightCost: row.freightCost === null ? null : Number(row.freightCost),
        taxAmount: row.taxAmount === null ? null : Number(row.taxAmount),
        estimatedLandedCost:
          row.estimatedLandedCost === null ? null : Number(row.estimatedLandedCost),
        unitLandedCost: row.unitLandedCost === null ? null : Number(row.unitLandedCost),
        deliveryDays: row.deliveryDays,
        reliabilityScore: row.reliabilityScore === null ? null : Number(row.reliabilityScore),
        specificationMatch: row.specificationMatch,
        reasons: Array.isArray(row.reasonsJson) ? row.reasonsJson : [],
        dataGaps: Array.isArray(row.dataGapsJson) ? row.dataGapsJson : [],
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    console.error("[sourcing] session fetch failed:", error);
    return NextResponse.json({ message: "Failed to load the sourcing session" }, { status: 500 });
  }
}

// Tags this sourcing session to a Site — the AI-ordering equivalent of the
// checkout "select a site" step. Called by the assistant UI once the
// customer answers "Which site is this order for?" (or when exactly one
// site exists and is auto-selected), so a validated siteId is attached to
// the session BEFORE the customer reaches order confirmation.
//
// SECURITY: setSessionSite() re-validates that the Site belongs to this
// builder and is ACTIVE — an unowned/foreign/archived siteId is never
// persisted, regardless of what the client (or the AI) sent.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const existing = await getSession(user.id, params.id);
    if (!existing) {
      return NextResponse.json({ message: "Sourcing session not found" }, { status: 404 });
    }

    // A CONFIRMED session's site is immutable — it already became an Order's
    // siteId and must not be silently changed after the fact.
    if (existing.status === "CONFIRMED") {
      return NextResponse.json(
        { message: "This sourcing request has already been confirmed." },
        { status: 409 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as { siteId?: unknown };
    const siteId =
      body.siteId === null
        ? null
        : typeof body.siteId === "string" && body.siteId.trim()
          ? body.siteId.trim()
          : undefined;

    if (siteId === undefined) {
      return NextResponse.json({ message: "siteId must be a string or null" }, { status: 400 });
    }

    const updated = await setSessionSite(user.id, params.id, siteId);
    if (!updated) {
      // Either the session vanished mid-request, or the siteId failed
      // ownership/active-status verification inside setSessionSite().
      return NextResponse.json({ message: "Selected site was not found." }, { status: 404 });
    }

    const site = updated.siteId
      ? await prisma.site.findUnique({
          where: { id: updated.siteId },
          select: { name: true },
        })
      : null;

    return NextResponse.json({ siteId: updated.siteId, siteName: site?.name ?? null });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    console.error("[sourcing] session site update failed:", error);
    return NextResponse.json({ message: "Failed to update the sourcing session" }, { status: 500 });
  }
}
