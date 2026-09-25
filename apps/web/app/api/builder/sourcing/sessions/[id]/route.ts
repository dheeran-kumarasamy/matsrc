import { NextResponse } from "next/server";

import { getOrCreateBuilder, getUserCtx, prisma } from "@/lib/builder-db";
import { loadGeographyIndex } from "@/lib/sourcing/sourcing-data";
import {
  findMatchingSitesForBuilder,
  getRecommendations,
  getSession,
  setSessionSite,
} from "@/lib/sourcing/session-store";
import { isSiteLocationMatch } from "@/lib/sourcing/site-location-matcher";
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

    // Location-aware site selection: resolve which of the builder's ACTIVE
    // sites match the requirement's requested delivery location, through the
    // SINGLE authoritative matcher (site-location-matcher.ts) — the UI must
    // never decide this independently. `allSites` is also returned so the
    // client can offer an explicit "use an existing site instead" override
    // without a second round trip.
    const siteMatch = await findMatchingSitesForBuilder(
      user.id,
      session.requirement.location,
      geography
    );

    // Derived (not stored) — distinguishes an automatic, location-appropriate
    // selection from an explicit customer override, purely from data already
    // on hand (no schema change required, per the feature spec's "extend
    // state only if necessary"):
    //   NO_SITE          — nothing selected yet
    //   MATCHED_LOCATION — the selected site matches the requested location
    //                      (whether it was auto-selected as the sole match,
    //                      or chosen from several matching options)
    //   USER_SELECTED    — no delivery location could be determined at all,
    //                      so the selection carries no location claim either
    //                      way — this is NOT proof the site is correct.
    //   USER_OVERRIDE    — a location WAS requested, and the selected site
    //                      does not match it: the customer explicitly chose
    //                      an existing site anyway.
    type SiteSelectionReason = "MATCHED_LOCATION" | "USER_SELECTED" | "USER_OVERRIDE" | "NO_SITE";
    let siteSelectionReason: SiteSelectionReason;
    if (!session.siteId || !site) {
      siteSelectionReason = "NO_SITE";
    } else if (!siteMatch.requestedLocation) {
      siteSelectionReason = "USER_SELECTED";
    } else {
      siteSelectionReason = isSiteLocationMatch(
        { id: site.id, name: site.name, city: site.city, state: site.state },
        siteMatch.requestedLocation,
        geography
      )
        ? "MATCHED_LOCATION"
        : "USER_OVERRIDE";
    }

    return NextResponse.json({
      id: session.id,
      status: session.status,
      siteId: session.siteId,
      siteName: site?.name ?? null,
      siteLocation: site ? [site.city, site.state].filter(Boolean).join(", ") || null : null,
      siteSelectionReason,
      requestedLocation: siteMatch.requestedLocation,
      matchingSites: siteMatch.matches,
      allSites: siteMatch.allSites,
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
          select: { id: true, name: true, city: true, state: true },
        })
      : null;

    // Immediate location-match feedback so the UI can show an override
    // warning right after selection, without a second round trip.
    const requestedLocation = updated.requirement.location;
    const siteSelectionReason: "MATCHED_LOCATION" | "USER_SELECTED" | "USER_OVERRIDE" | "NO_SITE" =
      !site
        ? "NO_SITE"
        : !requestedLocation
          ? "USER_SELECTED"
          : isSiteLocationMatch(
                { id: site.id, name: site.name, city: site.city, state: site.state },
                requestedLocation
              )
            ? "MATCHED_LOCATION"
            : "USER_OVERRIDE";

    return NextResponse.json({
      siteId: updated.siteId,
      siteName: site?.name ?? null,
      siteSelectionReason,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    console.error("[sourcing] session site update failed:", error);
    return NextResponse.json({ message: "Failed to update the sourcing session" }, { status: 500 });
  }
}
