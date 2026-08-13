import { NextResponse } from "next/server";

import { getOrCreateBuilder, getUserCtx, prisma } from "@/lib/builder-db";
import { createOrdersFromCart } from "@/lib/order-checkout";
import {
  getRecommendations,
  getSession,
  markSessionConfirmed,
  recordToolInvocation,
} from "@/lib/sourcing/session-store";

export const dynamic = "force-dynamic";

// THE HUMAN-APPROVAL BOUNDARY (§14).
//
//   AI recommends -> CUSTOMER APPROVES -> system performs the action
//
// This is the ONLY sourcing route that writes anything consequential, and it
// runs exclusively in response to an explicit customer action (the "Proceed"
// button). Notably:
//   - the AI cannot reach it: it is not in the tool set the model influences,
//     and the turn pipeline never invokes it
//   - the customer must name the exact recommendation they approved; the server
//     will not "pick the best one" on their behalf
//   - an already-CONFIRMED session cannot be re-confirmed (no duplicate
//     enquiries from a double-click or a replayed request)
//   - it creates an ENQUIRY through the existing shared checkout pipeline
//     (createOrdersFromCart). It does not place a purchase, move money, alter
//     supplier records or change pricing.

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const session = await getSession(user.id, params.id);
    if (!session) {
      return NextResponse.json({ message: "Sourcing session not found" }, { status: 404 });
    }

    // Idempotency: never create a second enquiry for an already-approved session.
    if (session.status === "CONFIRMED") {
      return NextResponse.json(
        {
          message: "This sourcing request has already been confirmed.",
          orderId: session.confirmedOrderId,
        },
        { status: 409 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      recommendationId?: unknown;
      siteId?: unknown;
    };

    const recommendationId =
      typeof body.recommendationId === "string" && body.recommendationId.trim()
        ? body.recommendationId.trim()
        : null;

    // EXPLICIT APPROVAL REQUIRED: without a named recommendation there is no
    // approval, and therefore no action.
    if (!recommendationId) {
      return NextResponse.json(
        { message: "Select the supplier you want to proceed with." },
        { status: 400 }
      );
    }

    // The recommendation must belong to THIS session, which belongs to THIS
    // user — so a caller cannot approve a recommendation from another session.
    const recommendations = await getRecommendations(user.id, session.id);
    const approved = recommendations.find((row) => row.id === recommendationId);
    if (!approved) {
      return NextResponse.json({ message: "Recommendation not found" }, { status: 404 });
    }

    if (approved.estimatedLandedCost === null) {
      // Refuse to commit the customer to an option with no verified cost.
      return NextResponse.json(
        {
          message:
            "I don't have verified pricing for this supplier yet, so I can't proceed. I can request a fresh quotation instead.",
        },
        { status: 409 }
      );
    }

    if (!approved.productId) {
      return NextResponse.json(
        { message: "This recommendation is no longer linked to a live product." },
        { status: 409 }
      );
    }

    // Re-verify the product is still active at approval time; a listing may have
    // been delisted between the recommendation and the click.
    const product = await prisma.product.findFirst({
      where: { id: approved.productId, isActive: true },
      select: { id: true },
    });
    if (!product) {
      return NextResponse.json(
        { message: "That product is no longer available. Please run the search again." },
        { status: 409 }
      );
    }

    return await performApprovedSourcing({
      userId: user.id,
      sessionId: session.id,
      sessionSiteId: session.siteId,
      recommendationId,
      approved,
      requestedSiteId: typeof body.siteId === "string" ? body.siteId.trim() : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    console.error("[sourcing] confirm failed:", error);
    return NextResponse.json(
      { message: "I couldn't submit that request. Please try again." },
      { status: 500 }
    );
  }
}

type ApprovedRecommendation = Awaited<ReturnType<typeof getRecommendations>>[number];

/**
 * Performs the approved action. Split out purely for readability — it is only
 * ever reached after every ownership, idempotency, pricing and availability
 * check above has passed.
 */
async function performApprovedSourcing(params: {
  userId: string;
  sessionId: string;
  sessionSiteId: string | null;
  recommendationId: string;
  approved: ApprovedRecommendation;
  requestedSiteId: string | null;
}): Promise<NextResponse> {
  const { userId, sessionId, recommendationId, approved } = params;
  const started = Date.now();

  // Record the approval BEFORE acting, so the audit trail always shows the
  // customer's consent preceding the consequential action.
  await recordToolInvocation({
    userId,
    sessionId,
    tool: "confirm_recommendation",
    input: {
      recommendationId,
      supplierId: approved.supplierId,
      productId: approved.productId,
      quantity: approved.quantity,
    },
    resultSummary: { estimatedLandedCost: Number(approved.estimatedLandedCost) },
    status: "OK",
    approvalStatus: "APPROVED",
  });

  // Reuse the EXISTING enquiry pipeline: stage the approved line as a cart item,
  // then submit through createOrdersFromCart — the same path cart checkout and
  // Quick Material Request use. No forked order-creation logic.
  await prisma.cartItem.upsert({
    where: { userId_productId: { userId, productId: approved.productId as string } },
    update: { quantity: approved.quantity },
    create: { userId, productId: approved.productId as string, quantity: approved.quantity },
  });

  const siteId = params.requestedSiteId || params.sessionSiteId;
  const result = await createOrdersFromCart(userId, { siteId });

  if (!result.ok) {
    await recordToolInvocation({
      userId,
      sessionId,
      tool: "confirm_recommendation",
      input: { recommendationId },
      resultSummary: { error: result.error },
      status: "ERROR",
      approvalStatus: "APPROVED",
      latencyMs: Date.now() - started,
    });
    return NextResponse.json({ message: result.error }, { status: result.status });
  }

  const orderId = result.orders[0]?.id ?? null;
  await markSessionConfirmed(userId, sessionId, recommendationId, orderId);

  console.log(
    `[sourcing] confirmed sessionId=${sessionId} recommendationId=${recommendationId} supplierId=${approved.supplierId} orders=${result.orders.length} latencyMs=${Date.now() - started}`
  );

  return NextResponse.json(
    {
      message: "Enquiry submitted to the selected supplier.",
      orders: result.orders,
      supplierName: approved.supplier.companyName,
    },
    { status: 201 }
  );
}
