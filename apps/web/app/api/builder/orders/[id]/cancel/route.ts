import { NextResponse } from "next/server";
import { OrderStatus, lockAdvanceAccountRow, releaseAdvanceReservation } from "@matsrc/db";
import { getOrCreateBuilder, getUserCtx, prisma } from "@/lib/builder-db";
import {
  builderCancellationRejectionReason,
  formatBuilderCancellationNote,
  isBuilderCancellableOrderStatus,
  isCancellationReasonKey,
} from "@/lib/order-cancellation";

export const dynamic = "force-dynamic";

// POST /api/builder/orders/[id]/cancel
//
// Builder-initiated order cancellation. This is the ONLY sanctioned way for a
// builder to change an order's confirmed quantity requirement without editing
// a Purchase Order directly: cancel the current order (if eligible) and start
// a fresh enquiry (via the existing sourcing/cart flow) for the new quantity.
//
// Cancellation eligibility (see lib/order-cancellation.ts) mirrors the
// existing, already-established transition rules for this enum — no new
// cancellation policy is introduced here, this only lets the *builder*
// trigger the same PLACED -> CANCELLED transition the supplier's own
// "Decline Enquiry" action already performs.
//
// This never touches the order's PurchaseOrder/PurchaseOrderLineItem rows —
// a confirmed PO's quantity remains exactly as issued, and payment fields are
// left untouched (see note below).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    // Optional cancellation reason (§5) — folded into OrderTracking.note
    // below rather than a new column; an absent/invalid body still cancels
    // the order exactly as before (backward compatible with any existing
    // caller that posts no body).
    const body = await request.json().catch(() => ({}));
    const reasonKey = isCancellationReasonKey(body?.reason) ? body.reason : null;
    const otherDetail = typeof body?.otherDetail === "string" ? body.otherDetail : null;

    // Order lookup is scoped to `userId: user.id` — a builder can only ever
    // find/cancel their OWN order. A mismatched id (another builder's order,
    // or one that doesn't exist) yields the identical 404 below, so this
    // never discloses whether the order exists for someone else.
    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, status: true, paymentStatus: true },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!isBuilderCancellableOrderStatus(order.status)) {
      return NextResponse.json(
        { error: builderCancellationRejectionReason(order.status) },
        { status: 400 }
      );
    }

    // No payment transfer/refund logic is invoked here — a PLACED order (the
    // only status this endpoint accepts) is, by definition, still awaiting
    // supplier confirmation and therefore has no completed payment to
    // reconcile (see PaymentStatus.PAID/REFUNDED handling elsewhere, e.g.
    // app/api/builder/orders/[id]/route.ts's paymentMethod guard). The
    // PurchaseOrder/PurchaseOrderLineItem rows for this order (if a PO was
    // already issued) are never read or written here, so the confirmed PO
    // quantity is guaranteed untouched by this action.
    //
    // Advance Balance reservation release: defensive/future-proofing — in
    // today's application flow a PLACED order cannot yet have an advance
    // reservation (the "Use Advance Balance" panel only appears once
    // paymentLinkAvailable is true, which requires the order to have left
    // PLACED), but if that ever changes, cancellation must never leave
    // advance money permanently RESERVED. Atomic with the cancellation
    // itself — if the release somehow fails, the whole transaction (and the
    // cancellation) rolls back rather than leaving an inconsistent state.
    const updated = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELLED },
        select: { id: true, status: true },
      });

      await tx.orderTracking.create({
        data: {
          orderId: order.id,
          status: OrderStatus.CANCELLED,
          note: formatBuilderCancellationNote(reasonKey, otherDetail),
        },
      });

      const advanceAccount = await tx.customerAdvanceAccount.findFirst({
        where: { buyerId: user.id },
        select: { id: true },
      });
      if (advanceAccount) {
        const locked = await lockAdvanceAccountRow(tx as any, advanceAccount.id);
        await releaseAdvanceReservation(tx as any, {
          orderId: order.id,
          createdBy: user.id,
          currentAvailable: Number(locked.availableBalance),
          currentReserved: Number(locked.reservedBalance),
        });
      }

      return cancelled;
    });

    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (error) {
    console.error("Order cancel POST error:", error);
    return NextResponse.json({ error: "Failed to cancel order" }, { status: 500 });
  }
}
