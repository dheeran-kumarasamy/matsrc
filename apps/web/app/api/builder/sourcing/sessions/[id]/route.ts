import { NextResponse } from "next/server";

import { getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { getRecommendations, getSession } from "@/lib/sourcing/session-store";

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

    return NextResponse.json({
      id: session.id,
      status: session.status,
      siteId: session.siteId,
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
