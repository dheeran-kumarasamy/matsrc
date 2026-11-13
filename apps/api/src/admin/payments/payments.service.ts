import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import {
  OrderStatus,
  PaymentStatus,
  PaymentVerificationStatus,
  generateOrderNumber,
  lockAdvanceAccountRow,
  consumeAdvanceReservation,
  releaseAdvanceReservation,
  resolveOrderConfirmationSnapshot,
  assertFullOrderSnapshotIntegrity,
  ConcurrentConfirmationLostError,
  type OrderConfirmationSnapshot,
} from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationService } from "src/notifications/notification.service";
import { CustomerOrderStatusNotificationService } from "src/notification-engine/whatsapp/customer-order-status-notification.service";

// Payment-Approval Eligibility (Phase 4.4) — which Order statuses this
// admin action is allowed to act on. Traced from existing business rules
// (apps/web/lib/order-cancellation.ts, apps/supplier/lib/
// order-status-transitions.ts, VALID_SUPPLIER_TRANSITIONS above): CANCELLED
// is the ONLY terminal status that means the order was definitively
// rejected/withdrawn — reachable from PLACED via either a builder
// self-cancel or a supplier decline (both before this transition exists in
// the codebase, confirmed by Phase 4.3's audit: no cancellation path
// touches PaymentVerification, so a PENDING verification can legitimately
// still exist for an order that has since been cancelled). Every other
// status (PLACED, PROCESSING, DISPATCHED, OUT_FOR_DELIVERY, DELIVERED)
// represents an order that is still progressing or has already been
// fulfilled — approving its payment is either the expected confirmation
// event (PLACED) or a safe, consistency-only no-op re-affirmation
// (anything already past PLACED, which this function's existing
// `isGenuineConfirmation` branch already treats as "already confirmed,
// validate-don't-recompute"). This is strictly a read of EXISTING
// transition rules, not a new status policy.
function isApprovalEligibleOrderStatus(status: OrderStatus): boolean {
  return status !== OrderStatus.CANCELLED;
}

// Thrown when payment approval is attempted against an order whose current
// status makes approval unsafe (currently: CANCELLED only — see
// isApprovalEligibleOrderStatus). Distinguished from
// ConcurrentConfirmationLostError: that one means "a concurrent request won
// the race and this request should adopt its result"; this one means "no
// request should ever approve payment for this order in its current state,
// racing or not".
class PaymentApprovalIneligibleError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly status: OrderStatus
  ) {
    super(`Order ${orderId} has status ${status} and is not eligible for payment approval.`);
    this.name = "PaymentApprovalIneligibleError";
  }
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly customerOrderStatusNotificationService: CustomerOrderStatusNotificationService
  ) {}

  // List every order whose bank-transfer payment proof is currently
  // PENDING admin review, for the admin payments queue.
  async findPendingVerifications() {
    const verifications = await this.prisma.paymentVerification.findMany({
      where: { status: PaymentVerificationStatus.PENDING },
      include: {
        order: {
          select: {
            id: true,
            enquiryId: true,
            status: true,
            totalAmount: true,
            paymentMethod: true,
            // Admin visibility (spec §33): lets the review screen answer
            // "Advance Reserved: X / Advance Status: ACTIVE" alongside the
            // external payment it's reviewing.
            advanceReservation: { select: { amount: true, status: true } },
          },
        },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { submittedAt: "asc" },
    });

    return verifications.map((v) => this.serializeSummary(v as any));
  }

  // List every order whose bank-transfer payment proof has been APPROVED —
  // i.e. every order that has satisfied the payment-verification
  // prerequisite for invoice generation (see
  // src/admin/invoices/invoices.service.ts's checkEligibility). Surfaced on
  // the same Admin payments page as the pending queue above so the Admin
  // has a single place to go from "verify payment" -> "generate invoice"
  // for a given order (Order.invoice is included so the UI can render
  // Generate Invoice vs View/Download Invoice without a second request).
  async findApprovedWithInvoiceStatus() {
    const verifications = await this.prisma.paymentVerification.findMany({
      where: { status: PaymentVerificationStatus.APPROVED },
      include: {
        order: {
          select: {
            id: true,
            enquiryId: true,
            status: true,
            totalAmount: true,
            paymentMethod: true,
            invoice: { select: { id: true, invoiceNumber: true } },
          },
        },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { reviewedAt: "desc" },
    });

    return verifications.map((v) => ({
      ...this.serializeSummary(v as any),
      invoice: v.order.invoice ? { id: v.order.invoice.id, invoiceNumber: v.order.invoice.invoiceNumber } : null,
    }));
  }

  // Full detail for a single order's payment verification, for the admin
  // review screen (excludes the raw screenshot bytes — those are only ever
  // served by the dedicated screenshot route below, gated the same way).
  async findOne(orderId: string) {
    const verification = await this.prisma.paymentVerification.findUnique({
      where: { orderId },
      include: {
        order: { select: { id: true, enquiryId: true, status: true, totalAmount: true, paymentMethod: true, paymentStatus: true } },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    if (!verification) {
      throw new NotFoundException("No payment verification found for this order");
    }
    return this.serializeSummary(verification);
  }

  // Returns the raw screenshot bytes + mime type for the admin-only viewer
  // route. Authorization (ADMIN role) is already enforced by the
  // controller's guards — this only checks the record exists.
  async getScreenshot(orderId: string) {
    const verification = await this.prisma.paymentVerification.findUnique({
      where: { orderId },
      select: { screenshotData: true, screenshotMimeType: true, screenshotFileName: true },
    });
    if (!verification) {
      throw new NotFoundException("No payment screenshot found for this order");
    }
    return verification;
  }

  // Approve Payment: marks the verification APPROVED, records who/when,
  // moves Order.paymentStatus to PAID, and hands off to the existing
  // supplier-processing workflow (order.status -> PROCESSING via the same
  // transition already used elsewhere, e.g. best-price selection) — never a
  // parallel/duplicate supplier-processing path. Idempotent: a second
  // approval call for an already-APPROVED payment is a no-op that returns
  // the existing state instead of re-triggering anything.
  async approve(orderId: string, actorId: string) {
    const verification = await this.prisma.paymentVerification.findUnique({
      where: { orderId },
      include: { order: true },
    });
    if (!verification) {
      throw new NotFoundException("No payment verification found for this order");
    }

    if (verification.status === PaymentVerificationStatus.APPROVED) {
      // Already approved — idempotent no-op, do not re-trigger anything.
      return this.serializeSummary({ ...verification, user: await this.getUser(verification.userId) } as any);
    }

    if (verification.status !== PaymentVerificationStatus.PENDING) {
      throw new BadRequestException("Only a payment awaiting verification can be approved");
    }

    // Payment-Approval Eligibility (Phase 4.4) — fast-fail path: an order
    // can be CANCELLED (builder self-cancel or supplier decline, both only
    // ever reachable from PLACED) while its PaymentVerification remains
    // PENDING, since no cancellation flow touches PaymentVerification (see
    // Phase 4.3's audit). Checked here AND atomically inside the
    // transaction below (see writeApprovalSideEffects) — this early check
    // is purely an optimization to avoid unnecessary GST-snapshot
    // resolution work; it is never relied upon alone for correctness,
    // since the order's status could still change between this read and
    // the transaction's write.
    if (!isApprovalEligibleOrderStatus(verification.order.status)) {
      throw new BadRequestException(
        `This order has been cancelled and its payment can no longer be approved.`
      );
    }

    const now = new Date();

    // Product-Level GST / GST-Inclusive Buyer Payable — this approval is a
    // FOURTH code path (alongside BestPriceSelectionService.
    // selectAndFinalizeIfEligible, apps/supplier's updateSupplierOrderStatus,
    // and OrdersService.updateStatus) capable of performing the exact same
    // PLACED -> PROCESSING transition, reachable whenever a buyer submits a
    // bank-transfer payment proof BEFORE the supplier has confirmed the
    // enquiry (the payment-proof upload route does not gate on
    // order.status). Without this, such an order would be left permanently
    // PROCESSING with a null GST snapshot (Phase 4.1 audit finding). This
    // mirrors OrdersService.updateStatus's own handling of the identical
    // "no quoteSelectionCompletedAt to key off of" situation: resolve the
    // snapshot BEFORE opening the write transaction, via the SAME shared
    // resolveOrderConfirmationSnapshot utility and each OrderItem's own
    // already-resolved markup snapshot — never a second/duplicated formula.
    //
    // Does NOT fabricate quoteSelectionCompletedAt/selectedSupplierId/
    // bestPriceTotal/tentativeDeliveryDate — this approval is a PAYMENT
    // confirmation event, not a SUPPLIER quote-selection event, so those
    // fields are intentionally left untouched, exactly as OrdersService.
    // updateStatus already does for this same transition. Accepted,
    // pre-existing, separately-tracked gap (Phase 3B) — not fabricated here.
    const isGenuineConfirmation = verification.order.status === OrderStatus.PLACED;
    let confirmationSnapshot: Awaited<ReturnType<typeof resolveOrderConfirmationSnapshot>> | null = null;

    if (isGenuineConfirmation) {
      const orderWithItems = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { product: true } } },
      });
      if (!orderWithItems) {
        throw new NotFoundException("Order not found");
      }

      confirmationSnapshot = await resolveOrderConfirmationSnapshot(
        this.prisma as any,
        orderWithItems.items.map((item) => ({
          lineItemId: item.id,
          productId: item.productId,
          categoryId: item.product.categoryId,
          supplierUnitPrice: item.supplierUnitPrice !== null ? Number(item.supplierUnitPrice) : Number(item.unitPrice),
          markupPercent: item.markupPercent !== null ? Number(item.markupPercent) : 0,
          quantity: item.quantity,
        }))
      );

      if (!confirmationSnapshot.ok) {
        throw new BadRequestException({
          message: "Cannot approve this payment: one or more products have no valid effective GST rate configured.",
          errors: confirmationSnapshot.errors,
        });
      }
    } else {
      // Legacy/retry safety: this order was already confirmed (by a prior
      // approval, or one of the other three confirmation paths) before this
      // approve() call started — validate ANY existing snapshot's FULL
      // integrity (order-level nullness/arithmetic AND per-line
      // nullability/reconciliation — see assertFullOrderSnapshotIntegrity)
      // rather than silently trusting it. Items are fetched here (a small,
      // additive query this branch didn't previously make) specifically to
      // run the stronger, line-level checks this phase adds — never to
      // recompute/overwrite anything.
      const existingSnapshotRow = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          totalAmount: true,
          taxAmount: true,
          finalPayableAmount: true,
          advancePercent: true,
          requiredAdvanceAmount: true,
          items: { select: { id: true, taxRatePercent: true, taxAmount: true } },
        },
      });
      if (existingSnapshotRow) {
        assertFullOrderSnapshotIntegrity(
          orderId,
          {
            totalAmount: Number(existingSnapshotRow.totalAmount),
            taxAmount: existingSnapshotRow.taxAmount !== null ? Number(existingSnapshotRow.taxAmount) : null,
            finalPayableAmount:
              existingSnapshotRow.finalPayableAmount !== null ? Number(existingSnapshotRow.finalPayableAmount) : null,
            advancePercent: existingSnapshotRow.advancePercent !== null ? Number(existingSnapshotRow.advancePercent) : null,
            requiredAdvanceAmount:
              existingSnapshotRow.requiredAdvanceAmount !== null ? Number(existingSnapshotRow.requiredAdvanceAmount) : null,
          },
          existingSnapshotRow.items.map((item) => ({
            id: item.id,
            taxRatePercent: item.taxRatePercent !== null ? Number(item.taxRatePercent) : null,
            taxAmount: item.taxAmount !== null ? Number(item.taxAmount) : null,
          }))
        );
      }
    }

    // Helper: the advance-reservation-consumption + verification-approval
    // writes this function always performs regardless of which branch
    // claims the order's own status/snapshot — factored out once so the
    // normal path and the lost-race recovery path below can never drift
    // into two subtly different implementations of the same writes.
    const applyApprovalWrites = (tx: any) => this.writeApprovalSideEffects(tx, { verification, orderId, actorId, now });

    let updatedVerification;
    let wonConfirmationRace = isGenuineConfirmation;
    try {
      updatedVerification = await this.prisma.$transaction(async (tx) => {
        const existingOrder = await tx.order.findUnique({
          where: { id: orderId },
          select: { orderNumber: true },
        });
        let orderNumber = existingOrder?.orderNumber;
        if (!orderNumber && isGenuineConfirmation) {
          orderNumber = await generateOrderNumber(tx as any);
        }

        if (isGenuineConfirmation) {
          // Concurrency guard — placed FIRST, before any other write in
          // this transaction, so a lost race rolls back cleanly (including
          // the orderNumber generation above). Conditional updateMany keyed
          // on the order still being PLACED (mirrors OrdersService.
          // updateStatus's identical guard for this same "no
          // quoteSelectionCompletedAt" data-model situation) — only one
          // concurrent request, whether a second approval call or any of
          // the other three confirmation paths racing against this one,
          // can affect a row here.
          const snapshotFields =
            confirmationSnapshot && confirmationSnapshot.ok
              ? {
                  taxAmount: confirmationSnapshot.snapshot.taxAmount,
                  finalPayableAmount: confirmationSnapshot.snapshot.finalPayableAmount,
                  advancePercent: confirmationSnapshot.snapshot.advancePercent,
                  requiredAdvanceAmount: confirmationSnapshot.snapshot.requiredAdvanceAmount,
                }
              : {};

          const claimed = await tx.order.updateMany({
            where: { id: orderId, status: OrderStatus.PLACED },
            data: { status: OrderStatus.PROCESSING, ...(orderNumber ? { orderNumber } : {}), ...snapshotFields },
          });
          if (claimed.count === 0) {
            throw new ConcurrentConfirmationLostError(orderId);
          }

          if (confirmationSnapshot && confirmationSnapshot.ok) {
            for (const lineSnapshot of confirmationSnapshot.snapshot.lines) {
              await tx.orderItem.update({
                where: { id: lineSnapshot.lineItemId },
                data: { taxRatePercent: lineSnapshot.taxRatePercent, taxAmount: lineSnapshot.taxAmount },
              });
            }
          }
        }

        return applyApprovalWrites(tx);
      });
    } catch (error) {
      if (error instanceof PaymentApprovalIneligibleError) {
        // The order was (or became) CANCELLED before writeApprovalSideEffects
        // ran — nothing was committed by this transaction. Surface a clean,
        // actionable 400 rather than letting the raw error propagate as a
        // generic 500, and never fall through to the lost-race recovery
        // logic below (this is not a race to recover from — no request
        // should ever approve this payment while the order is cancelled).
        throw new BadRequestException(
          "This order has been cancelled and its payment can no longer be approved."
        );
      }
      if (!(error instanceof ConcurrentConfirmationLostError)) {
        throw error;
      }
      // Lost the race — a concurrent request (another approval call, or
      // one of the other three confirmation paths) already finalized this
      // order's PLACED -> PROCESSING transition and snapshot. Never retry
      // the status/snapshot write, never recompute it, never send a second
      // round of order-status notifications for a transition this request
      // did not actually cause (mirrors every other confirmation path's
      // identical handling). The payment-verification APPROVED status and
      // the advance-reservation consumption are still this function's own,
      // unraced responsibility (never contended by the other three paths,
      // which never touch PaymentVerification/paymentStatus), so they are
      // applied in a fresh transaction now that the order-level race is
      // already resolved by the winner — BUT that fresh transaction's own
      // writeApprovalSideEffects call re-enforces the SAME CANCELLED
      // eligibility guard, so a winner that itself got cancelled before
      // this recovery runs is still correctly rejected (see the
      // PaymentApprovalIneligibleError catch immediately below).
      this.logger.warn(`Lost the confirmation race for order ${orderId} to a concurrent request.`);
      wonConfirmationRace = false;
      const finalized = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: { select: { id: true, taxRatePercent: true, taxAmount: true } } },
      });
      if (!finalized) throw error;
      // Explicit, fail-fast eligibility check on the winner's committed
      // status BEFORE applying any approval side effect — the atomic
      // updateMany guard inside writeApprovalSideEffects below is the
      // authoritative, race-safe enforcement (status could still change
      // again between this read and that write), but checking here too
      // avoids resolving the user/opening a second transaction at all for
      // the common case of a plainly-cancelled winner.
      if (!isApprovalEligibleOrderStatus(finalized.status)) {
        throw new BadRequestException(
          "This order has been cancelled and its payment can no longer be approved."
        );
      }
      // Validate the WINNER's full snapshot integrity (order-level +
      // per-line) before trusting it enough to apply this request's own
      // approval side effects — a lost race must never blindly assume the
      // winning transaction produced a consistent result.
      assertFullOrderSnapshotIntegrity(
        orderId,
        {
          totalAmount: Number(finalized.totalAmount),
          taxAmount: finalized.taxAmount !== null ? Number(finalized.taxAmount) : null,
          finalPayableAmount: finalized.finalPayableAmount !== null ? Number(finalized.finalPayableAmount) : null,
          advancePercent: finalized.advancePercent !== null ? Number(finalized.advancePercent) : null,
          requiredAdvanceAmount: finalized.requiredAdvanceAmount !== null ? Number(finalized.requiredAdvanceAmount) : null,
        },
        finalized.items.map((item) => ({
          id: item.id,
          taxRatePercent: item.taxRatePercent !== null ? Number(item.taxRatePercent) : null,
          taxAmount: item.taxAmount !== null ? Number(item.taxAmount) : null,
        }))
      );

      try {
        updatedVerification = await this.prisma.$transaction((tx) => applyApprovalWrites(tx));
      } catch (recoveryError) {
        if (recoveryError instanceof PaymentApprovalIneligibleError) {
          throw new BadRequestException(
            "This order has been cancelled and its payment can no longer be approved."
          );
        }
        throw recoveryError;
      }
    }

    const customer = await this.getUser(verification.userId);

    // Best-effort customer notification — never blocks the approval itself.
    const recipient = customer.phone?.trim();
    if (recipient) {
      void this.notificationService
        .sendWhatsApp({
          to: recipient,
          title: "Payment approved",
          body: `Your payment for order #${verification.order.enquiryId ?? orderId} has been verified. Your order is now being processed.`,
          idempotencyKey: `payment-approved:${orderId}`,
        })
        .catch(() => undefined);
    }

    // Notification Engine — customer_order_status WhatsApp template. Only
    // notify when THIS request actually won the PLACED -> PROCESSING
    // transition (wonConfirmationRace) — a payment approval for an order
    // already past PLACED, OR one that lost the confirmation race to a
    // concurrent request, must never send a second/duplicate transition
    // notification for a status change it did not itself cause.
    const orderStatusActuallyChanged = wonConfirmationRace;
    if (orderStatusActuallyChanged) {
      // Scheduled via Vercel's waitUntil() — apps/api runs as a Vercel
      // serverless function, so a detached `void` promise is not guaranteed
      // to finish before the instance is frozen after the HTTP response is
      // sent (see apps/supplier/lib/supplier-data.ts for the full
      // explanation of the production issue this fixes).
      waitUntil(
        this.customerOrderStatusNotificationService
          .notifyIfTransitioned({ orderId, previousStatus: verification.order.status, newStatus: OrderStatus.PROCESSING })
          .catch((error) => {
            this.logger.warn(`Failed to send customer_order_status notification for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`);
          })
      );
    }

    return this.serializeSummary({
      ...updatedVerification,
      order: { ...verification.order, status: OrderStatus.PROCESSING },
      user: customer,
    } as any);
  }

  // Shared by approve()'s normal path and its lost-confirmation-race
  // recovery path: the PaymentVerification/paymentStatus/OrderTracking/
  // advance-reservation-consumption/audit-log writes that are THIS
  // function's own, unraced responsibility regardless of which request won
  // the order's status/snapshot claim — factored out once so both callers
  // can never drift into two subtly different implementations.
  private async writeApprovalSideEffects(
    tx: any,
    params: { verification: any; orderId: string; actorId: string; now: Date }
  ) {
    const { verification, orderId, actorId, now } = params;

    // Payment-Approval Eligibility (Phase 4.4) — the SINGLE atomic
    // enforcement point for every call site of this helper (the normal
    // approval path, the non-genuine-confirmation path, AND the
    // lost-confirmation-race recovery path — see approve()'s three call
    // sites). A conditional updateMany keyed on the order NOT currently
    // being CANCELLED, re-checked freshly inside THIS transaction (never
    // trusting any earlier read, including the fast-fail check at the top
    // of approve() or the lost-race recovery's own re-read) — a concurrent
    // cancellation landing between any prior read and this write can never
    // be missed. Zero rows affected means the order has been cancelled
    // since the last read this call relied on; abort the whole transaction
    // (nothing committed, including the upcoming
    // PaymentVerification/advance/audit writes) rather than silently
    // marking a cancelled order's payment approved. The write itself
    // (paymentStatus: PAID) is folded into this SAME conditional
    // updateMany, rather than a separate no-op write, so there is exactly
    // one atomic statement doing both the eligibility check and the write.
    const eligible = await tx.order.updateMany({
      where: { id: orderId, status: { not: OrderStatus.CANCELLED } },
      data: { paymentStatus: PaymentStatus.PAID },
    });
    if (eligible.count === 0) {
      throw new PaymentApprovalIneligibleError(orderId, OrderStatus.CANCELLED);
    }

    const currentOrder = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
    const currentStatus = currentOrder?.status ?? OrderStatus.PROCESSING;

    const ver = await tx.paymentVerification.update({
      where: { id: verification.id },
      data: {
        status: PaymentVerificationStatus.APPROVED,
        reviewedAt: now,
        reviewedBy: actorId,
        rejectionReason: null,
      },
    });

    // OrderTracking.status mirrors the order's ACTUAL current status at the
    // moment of approval (never hardcoded to PROCESSING) — a payment
    // approved while the order is already DISPATCHED/DELIVERED (a safe,
    // consistency-only re-affirmation per isApprovalEligibleOrderStatus's
    // doc comment) must never claim a PROCESSING transition that did not
    // happen.
    await tx.orderTracking.create({
      data: {
        orderId,
        status: currentStatus,
        note:
          currentStatus === OrderStatus.PLACED || currentStatus === OrderStatus.PROCESSING
            ? "Payment verified by admin — order confirmed for supplier processing"
            : `Payment verified by admin (order already ${currentStatus})`,
      },
    });

    // Advance Balance reservation consumption (fixes the original bug:
    // advance was being permanently debited the moment the buyer applied
    // it, even while this external payment was still unconfirmed). This
    // approval IS the authoritative order-payment-confirmation event, so
    // if the buyer reserved any advance against this order, it is
    // consumed (RESERVED -> CONSUMED) atomically in the SAME transaction
    // as the order being marked PAID — never two separate commits that
    // could leave "order PAID, advance still RESERVED" or vice versa.
    // consumeAdvanceReservation is a no-op (returns null) if this order
    // never used advance, or if it was already consumed — so retrying
    // this helper after a lost race can never double-consume.
    const advanceAccount = await tx.customerAdvanceAccount.findFirst({
      where: { buyerId: verification.userId },
      select: { id: true },
    });
    if (advanceAccount) {
      const locked = await lockAdvanceAccountRow(tx as any, advanceAccount.id);
      await consumeAdvanceReservation(tx as any, {
        orderId,
        createdBy: actorId,
        reference: verification.order.enquiryId ?? orderId,
        currentAvailable: Number(locked.availableBalance),
        currentReserved: Number(locked.reservedBalance),
        approvedBy: actorId,
        approvedAt: now,
      });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: "PAYMENT_VERIFICATION_APPROVED",
        entityType: "PaymentVerification",
        entityId: verification.id,
        metadata: { orderId, amount: Number(verification.amount) },
      },
    });

    return ver;
  }

  // Reject Payment: marks the verification REJECTED with a stored reason,
  // records who/when, and resets Order.paymentStatus back to PENDING so the
  // order is NOT sent to supplier processing and the customer can resubmit
  // a new screenshot from the same payment page. Idempotent: rejecting an
  // already-REJECTED payment again just updates the reason/timestamp
  // without any duplicate order transition/notification.
  async reject(orderId: string, actorId: string, reason: string) {
    const verification = await this.prisma.paymentVerification.findUnique({
      where: { orderId },
      include: { order: true },
    });
    if (!verification) {
      throw new NotFoundException("No payment verification found for this order");
    }

    if (verification.status === PaymentVerificationStatus.APPROVED) {
      throw new BadRequestException("An already-approved payment cannot be rejected");
    }

    const now = new Date();
    const wasAlreadyRejected = verification.status === PaymentVerificationStatus.REJECTED;

    // Converted from the previous array-style $transaction([...]) to a
    // callback-style transaction so the Advance Balance reservation release
    // below (which needs to look up the buyer's account row and lock it)
    // can run atomically alongside the rejection + order reset — never two
    // separate commits that could leave "payment rejected, advance still
    // RESERVED".
    const updatedVerification = await this.prisma.$transaction(async (tx) => {
      const ver = await tx.paymentVerification.update({
        where: { id: verification.id },
        data: {
          status: PaymentVerificationStatus.REJECTED,
          reviewedAt: now,
          reviewedBy: actorId,
          rejectionReason: reason,
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: PaymentStatus.PENDING },
      });

      // Release any advance balance the buyer had RESERVED against this
      // order (fixes the original bug: advance was being permanently
      // debited even when this external payment ultimately failed). A
      // rejection is a definitive "this payment did not succeed" event, so
      // any ACTIVE reservation for the order is released back to the
      // buyer's available balance — never silently left RESERVED forever.
      // No-op (returns null) if this order never used advance, or if it
      // was already released/consumed.
      const advanceAccount = await tx.customerAdvanceAccount.findFirst({
        where: { buyerId: verification.userId },
        select: { id: true },
      });
      if (advanceAccount) {
        const locked = await lockAdvanceAccountRow(tx as any, advanceAccount.id);
        await releaseAdvanceReservation(tx as any, {
          orderId,
          createdBy: actorId,
          reference: verification.order.enquiryId ?? orderId,
          currentAvailable: Number(locked.availableBalance),
          currentReserved: Number(locked.reservedBalance),
        });
      }

      await tx.auditLog.create({
        data: {
          actorId,
          action: "PAYMENT_VERIFICATION_REJECTED",
          entityType: "PaymentVerification",
          entityId: verification.id,
          metadata: { orderId, reason },
        },
      });

      return ver;
    });

    const customer = await this.getUser(verification.userId);

    if (!wasAlreadyRejected) {
      const recipient = customer.phone?.trim();
      if (recipient) {
        void this.notificationService
          .sendWhatsApp({
            to: recipient,
            title: "Payment verification failed",
            body: `Your payment proof for order #${verification.order.enquiryId ?? orderId} could not be verified. Reason: ${reason}`,
            idempotencyKey: `payment-rejected:${orderId}:${now.getTime()}`,
          })
          .catch(() => undefined);
      }
    }

    return this.serializeSummary({
      ...updatedVerification,
      order: { ...verification.order, paymentStatus: PaymentStatus.PENDING },
      user: customer,
    } as any);
  }

  private async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true },
    });
    if (!user) {
      throw new ForbiddenException("Customer for this payment no longer exists");
    }
    return user;
  }

  private serializeSummary(v: {
    id: string;
    orderId: string;
    userId: string;
    paymentMethod: string;
    amount: any;
    status: PaymentVerificationStatus;
    screenshotFileName: string;
    submittedAt: Date;
    reviewedAt: Date | null;
    reviewedBy: string | null;
    rejectionReason: string | null;
    order: {
      id: string;
      enquiryId?: string | null;
      status: OrderStatus;
      totalAmount: any;
      paymentMethod: string;
      paymentStatus?: PaymentStatus;
      advanceReservation?: { amount: any; status: string } | null;
    };
    user: { id: string; name: string | null; email: string | null; phone: string | null };
  }) {
    return {
      id: v.id,
      orderId: v.orderId,
      // Meaningful Enquiry ID (e.g. "ABC-SITE01-000123") — see
      // packages/db/lib/enquiry-id.ts. Falls back to the raw order id for
      // pre-migration orders.
      enquiryId: v.order.enquiryId ?? v.orderId,
      orderStatus: v.order.status,
      orderTotal: Number(v.order.totalAmount),
      paymentAmount: Number(v.amount),
      paymentMethod: v.paymentMethod,
      customer: { id: v.user.id, name: v.user.name, email: v.user.email, phone: v.user.phone },
      status: v.status,
      screenshotFileName: v.screenshotFileName,
      submittedAt: v.submittedAt,
      reviewedAt: v.reviewedAt,
      reviewedBy: v.reviewedBy,
      rejectionReason: v.rejectionReason,
      // Admin visibility (spec §33) — lets the admin answer "Advance
      // Reserved: X / Advance Status: ACTIVE" without a separate lookup.
      // null when this order never used the Buildohub Advance Balance.
      advanceReserved: v.order.advanceReservation ? Number(v.order.advanceReservation.amount) : 0,
      advanceReservationStatus: v.order.advanceReservation?.status ?? null,
      // Consumed by the admin app's own /api/admin/payments/[orderId]/screenshot
      // proxy route (apps/admin), which re-authenticates the caller via the
      // NextAuth session and forwards to this NestJS admin/payments/:orderId/
      // screenshot endpoint — never a public/static URL.
      screenshotUrl: `/api/admin/payments/${v.orderId}/screenshot`,
    };
  }
}
