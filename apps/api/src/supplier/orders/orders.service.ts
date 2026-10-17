import { Injectable, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import {
  OrderStatus,
  PaymentStatus,
  generateOrderNumber,
  lockAdvanceAccountRow,
  releaseAdvanceReservation,
  resolveMarkupForProduct,
  resolveOrderConfirmationSnapshot,
  assertFullOrderSnapshotIntegrity,
  ConcurrentConfirmationLostError,
} from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { SupplierContextService } from "src/supplier/supplier-context.service";
import { formatDate, humanizeToken } from "src/supplier/utils";
import { NotificationService } from "src/notifications/notification.service";
import { CustomerOrderStatusNotificationService } from "src/notification-engine/whatsapp/customer-order-status-notification.service";
import { SupplierRfqReceivedNotificationService } from "src/notification-engine/whatsapp/supplier-rfq-received-notification.service";
import { PaymentRequiredNotificationService } from "src/notification-engine/whatsapp/payment-required-notification.service";

// Valid supplier-triggered transitions between the existing OrderStatus enum
// values (packages/db/prisma/schema.prisma) — mirrors the equivalent table
// in apps/supplier/lib/order-status-transitions.ts (the Next.js supplier
// portal's own backend, used by its order detail page actions). Both apps
// call into the same underlying database/business rules; this local copy
// exists because apps/api (NestJS) and apps/supplier (Next.js) are separate
// deployables that don't currently share application code beyond
// @matsrc/db, but the *rule* — PLACED -> PROCESSING|CANCELLED,
// PROCESSING -> DISPATCHED, DISPATCHED|OUT_FOR_DELIVERY -> DELIVERED,
// DELIVERED|CANCELLED terminal — must stay identical in both places.
const VALID_SUPPLIER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PLACED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.DISPATCHED],
  [OrderStatus.DISPATCHED]: [OrderStatus.DELIVERED],
  [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supplierContext: SupplierContextService,
    private readonly notificationService: NotificationService,
    private readonly customerOrderStatusNotificationService: CustomerOrderStatusNotificationService,
    private readonly supplierRfqReceivedNotificationService: SupplierRfqReceivedNotificationService,
    private readonly paymentRequiredNotificationService: PaymentRequiredNotificationService
  ) {}

  async findAll(user: any) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);

    const items = await this.prisma.orderItem.findMany({
      where: { supplierId: supplierProfile.id },
      include: { order: { include: { user: true } }, product: true },
      orderBy: { order: { createdAt: "desc" } },
    });

    return items.map((item) => ({
      id: item.orderId,
      enquiryId: item.order.enquiryId ?? item.orderId,
      orderNumber: item.order.orderNumber ?? null,
      buyer: item.order.user.name ?? item.order.user.phone ?? "Builder",
      material: item.product.name,
      qty: `${item.quantity} ${item.product.unit}`,
      status: item.order.status,
    }));
  }

  async findOne(id: string, user: any) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);

    const item = await this.prisma.orderItem.findFirst({
      where: { orderId: id, supplierId: supplierProfile.id },
      include: {
        order: {
          include: {
            user: true,
            tracking: { orderBy: { recordedAt: "asc" } },
          },
        },
        product: true,
      },
    });

    if (!item) {
      throw new NotFoundException("Order not found");
    }

    return {
      id: item.orderId,
      // Meaningful Enquiry ID (e.g. "EQ/2601/00001")
      enquiryId: item.order.enquiryId ?? item.orderId,
      orderNumber: item.order.orderNumber ?? null,
      buyer: item.order.user.name ?? item.order.user.phone ?? "Builder",
      deliveryDate: formatDate(item.deliveryDate ?? item.order.deliveryDate),
      quantity: `${item.quantity} ${item.product.unit}`,
      material: item.product.name,
      status: item.order.status,
      // C34: surfaced so updateStatus() below can enforce "paid before
      // delivery" using the order's *current* payment state at the moment
      // of the transition attempt, without a second round-trip.
      paymentStatus: item.order.paymentStatus,
      tracking: item.order.tracking.map((entry) => ({
        id: entry.id,
        label: entry.note ?? humanizeToken(entry.status),
        status: entry.status,
      })),
    };
  }

  async updateStatus(id: string, status: OrderStatus, user: any, note?: string): Promise<{ id: string; status: OrderStatus }> {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);
    const current = await this.findOne(id, user);

    // Backend transition guard — reject any transition not in
    // VALID_SUPPLIER_TRANSITIONS even if the caller (WhatsApp flow or a
    // direct API request) bypasses whatever UI gating exists. Keeps this
    // service from ever allowing e.g. dispatching an order that hasn't been
    // accepted yet, or re-confirming/declining an already-accepted enquiry.
    if (!VALID_SUPPLIER_TRANSITIONS[current.status]?.includes(status)) {
      throw new BadRequestException(
        `Invalid order status transition: cannot move from ${current.status} to ${status}`
      );
    }

    // C34 — server-side enforcement: an order must never be marked DELIVERED
    // while its payment is not yet settled. This is the single authoritative
    // place Order.status transitions to DELIVERED go through for every
    // caller — the supplier portal's "Mark Delivered" action (PATCH
    // /api/supplier/orders/:id via this same OrdersService in the NestJS
    // deployment) and the WhatsApp "DELIVERED <order-id>" bot flow
    // (OrderStatusFlow, src/whatsapp/flows/order-status.flow.ts) both call
    // this method, so gating here blocks every path, including a direct API
    // call that bypasses the UI entirely. Uses the existing PaymentStatus
    // enum (packages/db/prisma/schema.prisma) — PAID is the only status that
    // means payment has actually been settled, via any of the existing
    // payment methods (UPI/CARD/NET_BANKING/COD/CREDIT/BANK_TRANSFER): the
    // payment gateway/admin bank-transfer verification/admin invoice flow
    // all funnel into setting paymentStatus = PAID (see
    // apps/api/src/admin/payments/payments.service.ts and the ICICI
    // gateway integration) rather than this service ever guessing or
    // auto-marking payment itself. REFUNDED is deliberately NOT treated as
    // paid — a refunded order must not be delivered either.
    if (status === OrderStatus.DELIVERED && current.paymentStatus !== PaymentStatus.PAID) {
      throw new BadRequestException(
        "This order cannot be marked as delivered until payment has been confirmed."
      );
    }

    // Multi-supplier fan-out: a decline must not immediately cancel the whole
    // enquiry if other eligible candidate suppliers are still pending for any
    // line item — see packages/db/prisma/schema.prisma
    // OrderItemSupplierCandidate doc comment, and the mirrored implementation
    // in apps/supplier/lib/supplier-data.ts (declineOrderForSupplier).
    if (status === OrderStatus.CANCELLED) {
      const result = await this.declineForSupplier(id, supplierProfile.id, note);
      if (result) return result;
    }

    // Product-Level GST / GST-Inclusive Buyer Payable — this path (unlike
    // BestPriceSelectionService.selectAndFinalizeIfEligible and
    // apps/supplier's updateSupplierOrderStatus) NEVER sets
    // quoteSelectionCompletedAt/selectedSupplierId/bestPriceTotal on a
    // genuine PLACED -> PROCESSING transition — a pre-existing gap in this
    // path, out of scope to fix here (see Phase 3B investigation). The
    // quoteSelectionCompletedAt idempotency guard used by the other two
    // paths therefore DOES NOT FIT this one. The narrowest safe
    // concurrency guard on THIS path's actual data model is a conditional
    // updateMany keyed on `status` still being the caller-observed
    // `current.status` — functionally identical in effect (only one
    // concurrent request can flip a known-current status to a new one).
    let confirmationSnapshot: Awaited<ReturnType<typeof resolveOrderConfirmationSnapshot>> | null = null;
    const isGenuineConfirmation = status === OrderStatus.PROCESSING && current.status === OrderStatus.PLACED;

    if (isGenuineConfirmation) {
      const orderWithItems = await this.prisma.order.findUnique({
        where: { id },
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
          message: "Cannot confirm this enquiry: one or more products have no valid effective GST rate configured.",
          errors: confirmationSnapshot.errors,
        });
      }
    } else {
      // Legacy/retry safety: validate ANY existing snapshot's FULL
      // integrity (order-level nullness/arithmetic AND per-line
      // nullability/reconciliation) on every other transition too — never
      // silently repair a partial/corrupted snapshot (see Order.taxAmount's
      // schema doc comment: "all four set together or not at all"). Items
      // are fetched here (a small, additive query this branch didn't
      // previously make) specifically to run the stronger, line-level
      // checks this phase adds — never to recompute/overwrite anything.
      const existingSnapshotRow = await this.prisma.order.findUnique({
        where: { id },
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
          id,
          {
            totalAmount: Number(existingSnapshotRow.totalAmount),
            taxAmount: existingSnapshotRow.taxAmount !== null ? Number(existingSnapshotRow.taxAmount) : null,
            finalPayableAmount:
              existingSnapshotRow.finalPayableAmount !== null ? Number(existingSnapshotRow.finalPayableAmount) : null,
            advancePercent: existingSnapshotRow.advancePercent !== null ? Number(existingSnapshotRow.advancePercent) : null,
            requiredAdvanceAmount:
              existingSnapshotRow.requiredAdvanceAmount !== null
                ? Number(existingSnapshotRow.requiredAdvanceAmount)
                : null,
          },
          existingSnapshotRow.items.map((item) => ({
            id: item.id,
            taxRatePercent: item.taxRatePercent !== null ? Number(item.taxRatePercent) : null,
            taxAmount: item.taxAmount !== null ? Number(item.taxAmount) : null,
          }))
        );
      }
    }

    let order;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.order.findUnique({
          where: { id },
          select: { orderNumber: true },
        });

        let orderNumber = existing?.orderNumber;
        if (!orderNumber && status === OrderStatus.PROCESSING) {
          orderNumber = await generateOrderNumber(tx as any);
        }

        const snapshotFields =
          confirmationSnapshot && confirmationSnapshot.ok
            ? {
                taxAmount: confirmationSnapshot.snapshot.taxAmount,
                finalPayableAmount: confirmationSnapshot.snapshot.finalPayableAmount,
                advancePercent: confirmationSnapshot.snapshot.advancePercent,
                requiredAdvanceAmount: confirmationSnapshot.snapshot.requiredAdvanceAmount,
              }
            : {};

        if (isGenuineConfirmation) {
          // Concurrency guard — re-check eligibility immediately before the
          // write, inside the transaction: a conditional updateMany keyed
          // on the order still being in the exact current.status this
          // request observed. A losing request throws before writing any
          // OrderItem, so no line item is ever partially updated.
          const claimed = await tx.order.updateMany({
            where: { id, status: current.status },
            data: { status, ...(orderNumber ? { orderNumber } : {}), ...snapshotFields },
          });
          if (claimed.count === 0) {
            throw new ConcurrentConfirmationLostError(id);
          }

          if (confirmationSnapshot && confirmationSnapshot.ok) {
            for (const lineSnapshot of confirmationSnapshot.snapshot.lines) {
              await tx.orderItem.update({
                where: { id: lineSnapshot.lineItemId },
                data: { taxRatePercent: lineSnapshot.taxRatePercent, taxAmount: lineSnapshot.taxAmount },
              });
            }
          }
        } else {
          await tx.order.update({
            where: { id },
            data: { status, ...(orderNumber ? { orderNumber } : {}) },
          });
        }

        return tx.order.findUniqueOrThrow({
          where: { id },
          include: { items: { include: { supplier: true } } },
        });
      });
    } catch (error) {
      if (error instanceof ConcurrentConfirmationLostError) {
        // Lost the race — a concurrent request already finalized this
        // order. Re-read fresh and return the winner's result rather than
        // surfacing an error, retrying the write, or sending a second
        // round of notifications for a transition this request did not
        // actually cause (mirrors BestPriceSelectionService /
        // updateSupplierOrderStatus's identical handling).
        const finalized = await this.prisma.order.findUnique({
          where: { id },
          include: { items: { select: { id: true, taxRatePercent: true, taxAmount: true } } },
        });
        if (!finalized) throw error;
        // Validate the WINNER's full snapshot integrity (order-level +
        // per-line) before trusting it enough to return it as this
        // request's own result — a lost race must never blindly assume the
        // winning transaction produced a consistent result.
        assertFullOrderSnapshotIntegrity(
          id,
          {
            totalAmount: Number(finalized.totalAmount),
            taxAmount: finalized.taxAmount !== null ? Number(finalized.taxAmount) : null,
            finalPayableAmount: finalized.finalPayableAmount !== null ? Number(finalized.finalPayableAmount) : null,
            advancePercent: finalized.advancePercent !== null ? Number(finalized.advancePercent) : null,
            requiredAdvanceAmount:
              finalized.requiredAdvanceAmount !== null ? Number(finalized.requiredAdvanceAmount) : null,
          },
          finalized.items.map((item) => ({
            id: item.id,
            taxRatePercent: item.taxRatePercent !== null ? Number(item.taxRatePercent) : null,
            taxAmount: item.taxAmount !== null ? Number(item.taxAmount) : null,
          }))
        );
        return { id: finalized.id, status: finalized.status };
      }
      throw error;
    }

    await this.prisma.orderTracking.create({
      data: {
        orderId: id,
        status,
        note: note ?? (status === OrderStatus.PROCESSING ? "Supplier confirmed enquiry" : `Supplier marked order as ${humanizeToken(status)}`),
      },
    });


    void this.notificationService.notifyBuilderOrderDecision(id, status).catch((error) => {
      this.logger.warn(`Failed to queue builder notification for order ${id}: ${error instanceof Error ? error.message : String(error)}`);
    });

    // Notification Engine — customer_order_status Meta WhatsApp template
    // (Meta template ID 1788249542353441). This is the SINGLE authoritative
    // customer-facing WhatsApp send for an order-status transition — the
    // previous duplicate sends via WhatsAppAlertService (Twilio,
    // "order_status_update" template) and WhatsAppLifecycleService
    // (notifyBuilderOrderStatusTransition) have been removed from this call
    // site; see docs/notifications/customer-order-status-meta-migration.md
    // for the full audit of why those two were pure duplicates of this one
    // notification (both WhatsAppAlertService and WhatsAppLifecycleService
    // remain in use elsewhere in this codebase for unrelated notifications
    // — only their `customer_order_status`-duplicating responsibility was
    // removed here).
    //
    // `current.status` was read before this update and the
    // VALID_SUPPLIER_TRANSITIONS guard above already guarantees
    // `current.status !== status`, so every call here is a real transition;
    // never blocks/affects the order-status update above, and never throws.
    //
    // Scheduled via Vercel's waitUntil() rather than a detached `void`
    // promise — apps/api runs as a Vercel serverless function (see
    // apps/api/api/index.ts / vercel.json), so once this method returns and
    // the HTTP response is sent, Vercel may freeze/terminate the invocation
    // before a merely-`void`'d background promise gets a chance to finish
    // its Meta Graph API round-trip. This is the exact same reliability gap
    // diagnosed in apps/supplier's equivalent call site (see
    // updateSupplierOrderStatus in apps/supplier/lib/supplier-data.ts) —
    // fixed the same way here.
    waitUntil(
      this.customerOrderStatusNotificationService
        .notifyIfTransitioned({ orderId: id, previousStatus: current.status, newStatus: order.status })
        .catch((error) => {
          this.logger.warn(`Failed to send customer_order_status notification for order ${id}: ${error instanceof Error ? error.message : String(error)}`);
        })
    );

    // Notification Engine — payment_required WhatsApp template
    // (PAYMENT_REQUIRED event, Meta template ID 1457666726425273). Fires
    // only on a genuine PLACED -> PROCESSING transition while the order's
    // paymentStatus is still PENDING (re-checked fresh from the DB inside
    // the service itself) — see
    // packages/db/lib/payment-required-notification.ts's top doc comment
    // for the full audit of why this supplier "Confirm Enquiry" transition
    // is the correct, narrow trigger. Scheduled via Vercel's waitUntil() for
    // the same reliability reason as the notification above.
    waitUntil(
      this.paymentRequiredNotificationService
        .notifyIfTransitioned({ orderId: id, previousStatus: current.status, newStatus: order.status })
        .catch((error) => {
          this.logger.warn(`Failed to send payment_required notification for order ${id}: ${error instanceof Error ? error.message : String(error)}`);
        })
    );

    return { id: order.id, status: order.status };
  }

  // Multi-supplier fan-out: mirrors declineOrderForSupplier in
  // apps/supplier/lib/supplier-data.ts. When the acting supplier declines,
  // mark their candidate row DECLINED for every item they're currently
  // assigned to, promote the next-ranked PENDING candidate (if any) to
  // become the new active supplier for that item, and only actually cancel
  // the order (notifying the builder) once every item has no more eligible
  // candidates left.
  private async declineForSupplier(
    orderId: string,
    supplierId: string,
    reason?: string
  ): Promise<{ id: string; status: OrderStatus } | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      // Admin-Configurable Product Markup: `product` (for categoryId) is
      // needed to resolve the applicable markup for a promoted candidate's
      // ORIGINAL (supplier-side) price — see the promotion branch below.
      // Mirrors apps/supplier/lib/supplier-data.ts's declineOrderForSupplier
      // fix exactly.
      include: {
        items: {
          include: {
            candidates: { orderBy: { rank: "asc" } },
            product: { select: { categoryId: true } },
          },
        },
      },
    });
    if (!order) return null;

    const now = new Date();
    // Order-Total Synchronization: tracks whether any line's buyer-facing
    // unitPrice actually changed during this decline/promotion pass, so
    // Order.totalAmount can be resynced once, after the loop, from every
    // line's current (possibly just-promoted) price — mirrors the identical
    // pattern in declineOrderForSupplier / BestPriceSelectionService.
    let pricingChanged = false;

    for (const item of order.items) {
      if (item.supplierId !== supplierId) continue;

      const ownCandidate = item.candidates.find((c) => c.supplierId === supplierId);
      if (ownCandidate) {
        await this.prisma.orderItemSupplierCandidate.update({
          where: { id: ownCandidate.id },
          data: { status: "DECLINED", declineReason: reason ?? null, respondedAt: now },
        });
      }

      const nextCandidate = item.candidates.find(
        (c) => c.supplierId !== supplierId && c.status === "PENDING"
      );

      if (nextCandidate) {
        // Admin-Configurable Product Markup: OrderItemSupplierCandidate.unitPrice
        // is the ORIGINAL, never-marked-up supplier price captured for this
        // candidate at checkout time (see apps/web/lib/order-checkout.ts's
        // `candidates: { create: ... unitPrice: candidate.unitPrice }`,
        // sourced from the cross-supplier price resolver, never from a
        // marked-up figure). Promoting this candidate onto OrderItem.unitPrice
        // (a BUYER-facing field) must therefore re-apply markup here — it
        // must never copy the candidate's raw price straight across, exactly
        // like every other authoritative buyer-price-setting call site
        // (BestPriceSelectionService, declineOrderForSupplier).
        const supplierUnitPrice = Number(nextCandidate.unitPrice);
        const markup = await resolveMarkupForProduct(this.prisma as any, {
          productId: item.productId,
          categoryId: (item as any).product?.categoryId,
          supplierUnitPrice,
        }).catch(() => null);
        // Fail-safe fallback (same contract as BestPriceSelectionService /
        // declineOrderForSupplier): a missing/disabled markup configuration
        // must never block candidate promotion — the buyer is charged the
        // supplier's own price unmarked-up (0% markup) instead.
        const resolved = markup ?? { supplierUnitPrice, buyerUnitPrice: supplierUnitPrice, markupPercent: 0, markupAmount: 0 };
        if (!markup) {
          this.logger.warn(
            `No markup configuration found for product ${item.productId} — defaulting to 0% markup while promoting candidate for order ${orderId}.`
          );
        }

        await this.prisma.orderItem.update({
          where: { id: item.id },
          data: {
            supplierId: nextCandidate.supplierId,
            unitPrice: resolved.buyerUnitPrice,
            supplierUnitPrice: resolved.supplierUnitPrice,
            markupPercent: resolved.markupPercent,
            markupAmount: resolved.markupAmount,
            resolvedListingId: nextCandidate.listingId ?? undefined,
          },
        });
        pricingChanged = true;

        void this.notificationService.notifySupplierOrderSubmitted(orderId).catch((error) => {
          this.logger.warn(
            `Failed to notify promoted supplier for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`
          );
        });

        // Notification Engine — supplier_quote_alert WhatsApp template
        // (SUPPLIER_RFQ_RECEIVED) for the newly-promoted supplier. This is a
        // genuinely new assignment (different supplierId on the same
        // OrderItem), so its dedupe key is distinct from the original
        // supplier's — see supplier-rfq-received-notification.ts's doc
        // comment. Scheduled via waitUntil() — see the doc comment on the
        // equivalent call in updateStatus() above for why.
        waitUntil(
          this.supplierRfqReceivedNotificationService.notify(item.id).catch((error) => {
            this.logger.warn(
              `Failed to send supplier_quote_alert notification for promoted orderItem ${item.id}: ${error instanceof Error ? error.message : String(error)}`
            );
          })
        );
      } else {
        await this.prisma.orderItem.update({
          where: { id: item.id },
          data: { allCandidatesDeclined: true },
        });
      }
    }

    // Order-Total Synchronization: if any line's buyer-facing price changed
    // above (a promotion occurred), resync Order.totalAmount from the FULL,
    // current set of order lines — never leave it at the stale figure
    // computed before this decline/promotion. Mirrors the identical fix in
    // declineOrderForSupplier / BestPriceSelectionService. Run before the
    // fullyDeclined check below: a promotion and a full decline never
    // coincide for the same line (the if/else above are mutually
    // exclusive), so this always reflects a genuinely still-pending order
    // when it runs, and is simply a no-op (never reached) when every line
    // was fully declined instead.
    if (pricingChanged) {
      const refreshedItemsForTotal = await this.prisma.orderItem.findMany({
        where: { orderId },
        select: { unitPrice: true, quantity: true },
      });
      const totalAmount = refreshedItemsForTotal.reduce((sum, i) => sum + Number(i.unitPrice) * i.quantity, 0);
      await this.prisma.order.update({
        where: { id: orderId },
        data: { totalAmount },
      });
    }

    const refreshed = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!refreshed) return null;

    const fullyDeclined = refreshed.items.every((item) => item.allCandidatesDeclined);

    if (fullyDeclined) {
      // Advance Balance reservation release: defensive/future-proofing — in
      // today's application flow a PLACED order (the only status this
      // decline path runs from) cannot yet have an advance reservation (see
      // the identical note in apps/web's buyer-cancel route), but if that
      // ever changes, cancellation must never leave advance money
      // permanently RESERVED. Atomic with the cancellation itself.
      const cancelled = await this.prisma.$transaction(async (tx) => {
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.CANCELLED },
        });

        await tx.orderTracking.create({
          data: {
            orderId,
            status: OrderStatus.CANCELLED,
            note: "All eligible suppliers declined this enquiry",
          },
        });

        const advanceAccount = await tx.customerAdvanceAccount.findFirst({
          where: { buyerId: order.userId },
          select: { id: true },
        });
        if (advanceAccount) {
          const locked = await lockAdvanceAccountRow(tx as any, advanceAccount.id);
          await releaseAdvanceReservation(tx as any, {
            orderId,
            createdBy: "system",
            currentAvailable: Number(locked.availableBalance),
            currentReserved: Number(locked.reservedBalance),
          });
        }

        return updatedOrder;
      });

      void this.notificationService.notifyBuilderOrderDecision(orderId, OrderStatus.CANCELLED).catch((error) => {
        this.logger.warn(
          `Failed to send builder notification for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`
        );
      });

      // Notification Engine — customer_order_status WhatsApp template.
      // `order.status` above is the pre-fan-out status read at the top of
      // this method, before any candidate/order mutation — a genuine
      // transition into CANCELLED once every eligible supplier has declined.
      // Scheduled via waitUntil() — see the doc comment on the equivalent
      // call in updateStatus() above for why.
      waitUntil(
        this.customerOrderStatusNotificationService
          .notifyIfTransitioned({ orderId, previousStatus: order.status, newStatus: OrderStatus.CANCELLED })
          .catch((error) => {
            this.logger.warn(
              `Failed to send customer_order_status notification for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`
            );
          })
      );

      return { id: cancelled.id, status: cancelled.status };
    }

    // Not fully declined — order remains pending confirmation with the
    // (possibly newly-promoted) supplier(s); builder should NOT see a
    // rejection message.
    await this.prisma.orderTracking.create({
      data: {
        orderId,
        status: OrderStatus.PLACED,
        note: "A supplier declined this enquiry; reassigned to the next eligible supplier",
      },
    });

    return { id: refreshed.id, status: refreshed.status };
  }
}

