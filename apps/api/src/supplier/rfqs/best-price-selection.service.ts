import { Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import { waitUntil } from "@vercel/functions";
import { OrderStatus } from "@matsrc/db";
import {
  resolveOrderConfirmationSnapshot,
  assertFullOrderSnapshotIntegrity,
  hasCompleteOrderSnapshot,
  InconsistentOrderSnapshotError,
  ConcurrentConfirmationLostError,
  type OrderConfirmationSnapshot,
} from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { CustomerOrderStatusNotificationService } from "src/notification-engine/whatsapp/customer-order-status-notification.service";
import { PaymentRequiredNotificationService } from "src/notification-engine/whatsapp/payment-required-notification.service";
import { MarkupService } from "src/admin/markup/markup.service";


export type QuoteCandidate = {
  supplierId: string;
  unitPrice: number;
  leadTimeDays?: number | null;
  createdAt: Date;
};

export type BestLineItemSelection = {
  lineItemId: string;
  supplierId: string;
  // Admin-Configurable Product Markup: `unitPrice` here is now the
  // BUYER-FACING, marked-up price (what gets written onto
  // OrderItem.unitPrice) — `supplierUnitPrice` preserves the winning
  // SupplierQuote's own, never-modified original quotation. See
  // selectAndFinalizeIfEligible's resolution loop, the only writer.
  unitPrice: number;
  supplierUnitPrice: number;
  markupPercent: number;
  markupAmount: number;
  currency: string;
  leadTimeDays?: number | null;
};

export function selectLowestValidQuote(candidates: QuoteCandidate[]): QuoteCandidate {
  if (!candidates.length) {
    throw new Error("No candidates available for best-price selection");
  }

  const sorted = [...candidates].sort((left, right) => {
    if (left.unitPrice !== right.unitPrice) {
      return left.unitPrice - right.unitPrice;
    }

    const leftLead = left.leadTimeDays ?? Number.MAX_SAFE_INTEGER;
    const rightLead = right.leadTimeDays ?? Number.MAX_SAFE_INTEGER;
    if (leftLead !== rightLead) {
      return leftLead - rightLead;
    }

    const byTimestamp = left.createdAt.getTime() - right.createdAt.getTime();
    if (byTimestamp !== 0) {
      return byTimestamp;
    }

    return left.supplierId.localeCompare(right.supplierId);
  });

  return sorted[0];
}

@Injectable()
export class BestPriceSelectionService {
  private readonly logger = new Logger(BestPriceSelectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customerOrderStatusNotificationService: CustomerOrderStatusNotificationService,
    private readonly paymentRequiredNotificationService: PaymentRequiredNotificationService,
    private readonly markupService: MarkupService
  ) {}


  async selectAndFinalizeIfEligible(enquiryId: string): Promise<{
    enquiryId: string;
    selectedSupplierId: string | null;
    selectedSupplierName: string | null;
    bestPriceTotal: number;
    tentativeDeliveryDate: Date;
    lineItems: Array<BestLineItemSelection & { quantity: number; materialName: string }>;
    finalized: boolean;
    snapshot?: OrderConfirmationSnapshot | null;
  } | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: enquiryId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      return null;
    }

    if (order.quoteSelectionCompletedAt) {
      // Legacy/retry safety: this order was already finalized (by this
      // request's own earlier attempt, OR a concurrent request that won
      // the race below) — NEVER recompute/overwrite the frozen snapshot.
      // Validate the existing snapshot's FULL integrity first (order-level
      // nullness/arithmetic AND per-line nullability/reconciliation — see
      // Order.taxAmount's schema doc comment: "all four set together or
      // not at all") and surface a blocking error rather than silently
      // treating a corrupted partial snapshot as usable. Items are already
      // loaded above (include: { items: { include: { product } } }), so
      // this reuses that fetch rather than issuing a second query.
      assertFullOrderSnapshotIntegrity(
        enquiryId,
        {
          totalAmount: Number(order.totalAmount),
          taxAmount: order.taxAmount !== null ? Number(order.taxAmount) : null,
          finalPayableAmount: order.finalPayableAmount !== null ? Number(order.finalPayableAmount) : null,
          advancePercent: order.advancePercent !== null ? Number(order.advancePercent) : null,
          requiredAdvanceAmount: order.requiredAdvanceAmount !== null ? Number(order.requiredAdvanceAmount) : null,
        },
        order.items.map((item) => ({
          id: item.id,
          taxRatePercent: item.taxRatePercent !== null ? Number(item.taxRatePercent) : null,
          taxAmount: item.taxAmount !== null ? Number(item.taxAmount) : null,
        }))
      );

      return {
        enquiryId,
        selectedSupplierId: order.selectedSupplierId,
        selectedSupplierName: null,
        bestPriceTotal: Number(order.bestPriceTotal ?? 0),
        tentativeDeliveryDate: order.tentativeDeliveryDate ?? order.deliveryDate ?? new Date(),
        lineItems: [],
        finalized: false,
        snapshot: hasCompleteOrderSnapshot({
          taxAmount: order.taxAmount !== null ? Number(order.taxAmount) : null,
          finalPayableAmount: order.finalPayableAmount !== null ? Number(order.finalPayableAmount) : null,
          advancePercent: order.advancePercent !== null ? Number(order.advancePercent) : null,
          requiredAdvanceAmount: order.requiredAdvanceAmount !== null ? Number(order.requiredAdvanceAmount) : null,
        })
          ? {
              lines: [],
              subtotal: Number(order.bestPriceTotal ?? 0),
              taxAmount: Number(order.taxAmount),
              finalPayableAmount: Number(order.finalPayableAmount),
              advancePercent: order.advancePercent !== null ? Number(order.advancePercent) : null,
              requiredAdvanceAmount: order.requiredAdvanceAmount !== null ? Number(order.requiredAdvanceAmount) : null,
            }
          : null,
      };
    }

    const quotes = await this.prisma.supplierQuote.findMany({
      where: { enquiryId },
      orderBy: { createdAt: "desc" },
    });

    if (!quotes.length || !order.items.length) {
      return null;
    }

    const uniqueSuppliers = new Set(quotes.map((quote) => quote.supplierId));
    const minQuotes = this.resolvePositiveNumber(process.env.MIN_QUOTES_FOR_SELECTION, 1);
    const deadlineMinutes = this.resolvePositiveNumber(process.env.QUOTE_DEADLINE_MINUTES, 0);

    // RFQ Waiting-Window (agreed decision): the waiting window for
    // additional competing quotes starts from the FIRST VALID SUPPLIER
    // RESPONSE for this enquiry, never from Order.createdAt (the enquiry's
    // own creation time). An enquiry can sit unanswered for an arbitrary
    // period before any supplier responds — anchoring the deadline to
    // createdAt would silently shrink or already exhaust the window for
    // suppliers who are still legitimately within their response period
    // once the first quote finally arrives. `quotes` is already fetched
    // above (orderBy: createdAt desc); the first response is simply the
    // earliest of these rows, independent of their sort order.
    const firstResponseAt = quotes.reduce(
      (earliest, quote) => (quote.createdAt < earliest ? quote.createdAt : earliest),
      quotes[0].createdAt
    );
    const deadlineReached =
      deadlineMinutes > 0 && Date.now() >= firstResponseAt.getTime() + deadlineMinutes * 60 * 1000;

    if (!deadlineReached && uniqueSuppliers.size < minQuotes) {
      return null;
    }

    const winningLines: Array<BestLineItemSelection & { quantity: number; materialName: string }> = [];

    for (const item of order.items) {
      const lineQuotes = quotes.filter((quote) => quote.lineItemId === item.id);
      if (!lineQuotes.length) {
        return null;
      }

      const winner = selectLowestValidQuote(
        lineQuotes.map((quote) => ({
          supplierId: quote.supplierId,
          unitPrice: Number(quote.unitPrice),
          leadTimeDays: quote.leadTimeDays,
          createdAt: quote.createdAt,
        }))
      );

      // Admin-Configurable Product Markup (spec: "when an authoritative
      // supplier quote is selected, calculate the buyer price from the
      // winning original supplier price and the applicable markup").
      // `winner.unitPrice` is the supplier's OWN, never-marked-up
      // quotation — this is the ONLY place that figure is turned into the
      // buyer-facing OrderItem.unitPrice, so a later re-run of this same
      // selection (idempotency — see quoteSelectionCompletedAt's guard
      // above) can never compound/double the markup: once
      // quoteSelectionCompletedAt is set, this loop never re-executes for
      // this enquiry again.
      const markup = await this.markupService.resolveMarkupForProduct({
        productId: item.productId,
        categoryId: item.product.categoryId,
        supplierUnitPrice: winner.unitPrice,
      });

      // Fail-safe fallback (spec: "fail safely when required configuration
      // is invalid" / "missing or invalid configuration" test case): if no
      // markup setting is configured/enabled at ANY tier, the buyer is
      // charged the supplier's own price unmarked-up (0% markup) rather
      // than this method throwing and blocking order finalization — a
      // missing admin configuration must never silently block the
      // fundamental enquiry-to-order pipeline. This is logged so it is
      // visible/operable, never silent.
      const resolved =
        markup ?? { supplierUnitPrice: winner.unitPrice, buyerUnitPrice: winner.unitPrice, markupPercent: 0, markupAmount: 0 };
      if (!markup) {
        this.logger.warn(
          `No markup configuration found for product ${item.productId} (category ${item.product.categoryId}) — defaulting to 0% markup for enquiry ${enquiryId}.`
        );
      }

      winningLines.push({
        lineItemId: item.id,
        supplierId: winner.supplierId,
        unitPrice: resolved.buyerUnitPrice,
        supplierUnitPrice: resolved.supplierUnitPrice,
        markupPercent: resolved.markupPercent,
        markupAmount: resolved.markupAmount,
        currency: lineQuotes[0].currency,
        leadTimeDays: winner.leadTimeDays,
        quantity: item.quantity,
        materialName: item.product.name,
      });
    }

    const bestPriceTotal = winningLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const distinctWinningSuppliers = Array.from(new Set(winningLines.map((line) => line.supplierId)));
    const selectedSupplierId = distinctWinningSuppliers.length === 1 ? distinctWinningSuppliers[0] : null;

    const selectedSupplierProfile = selectedSupplierId
      ? await this.prisma.supplierProfile.findUnique({ where: { id: selectedSupplierId } })
      : null;

    const tentativeDeliveryDate = this.resolveTentativeDeliveryDate({
      requestedDate: order.deliveryDate,
      quoteLeadTimes: winningLines.map((line) => line.leadTimeDays),
      createdAt: order.createdAt,
    });

    const previousStatus = order.status;
    const newStatus = previousStatus === OrderStatus.PLACED ? OrderStatus.PROCESSING : previousStatus;

    // Product-Level GST / GST-Inclusive Buyer Payable — resolve the
    // GST-inclusive financial snapshot BEFORE opening the write
    // transaction. Markup is already resolved per-line above (never
    // re-resolved here — see order-confirmation-snapshot.ts's top doc
    // comment on why re-resolving would risk a second, independently-timed
    // read). STRICT CONTRACT: any line with no valid effective GST rate
    // aborts confirmation entirely — nothing is written, mirroring every
    // other required-configuration failure in this codebase (fail
    // actionable, never silently substitute a rate).
    const snapshotResolution = await resolveOrderConfirmationSnapshot(
      this.prisma as any,
      winningLines.map((line) => ({
        lineItemId: line.lineItemId,
        productId: order.items.find((item) => item.id === line.lineItemId)!.productId,
        categoryId: order.items.find((item) => item.id === line.lineItemId)!.product.categoryId,
        supplierUnitPrice: line.supplierUnitPrice,
        markupPercent: line.markupPercent,
        quantity: line.quantity,
      }))
    );

    if (!snapshotResolution.ok) {
      throw new UnprocessableEntityException({
        message: "Cannot confirm this enquiry: one or more products have no valid effective GST rate configured.",
        errors: snapshotResolution.errors,
      });
    }

    const { snapshot } = snapshotResolution;
    const snapshotByLineItemId = new Map(snapshot.lines.map((line) => [line.lineItemId, line]));

    // Supplier RFQ Price Revision & GST-Inclusive Order Value (spec §15):
    // the order must use the supplier's SUBMITTED RFQ quotation price, never
    // the current catalogue/listing price — `winningLines` above already
    // holds each line item's winning SupplierQuote.unitPrice (and winning
    // supplierId, for the multi-supplier-fan-out case where different line
    // items are won by different suppliers). OrderItem.unitPrice/supplierId
    // must be updated to match here, inside the same transaction as the
    // Order finalization, so the order that results from this RFQ actually
    // reflects what was quoted — not whatever unitPrice/supplierId the
    // OrderItem happened to be created with.
    const transactionResult = await this.prisma.$transaction(async (tx) => {
      // Concurrency guard — re-check eligibility immediately before the
      // write, inside the transaction: a conditional updateMany keyed on
      // quoteSelectionCompletedAt still being null. Only one concurrent
      // request can affect a row here; a losing request gets count === 0
      // and throws before writing anything else (no OrderItem is ever
      // partially updated by a request that lost this race). Narrowly
      // scoped to confirmation/snapshot atomicity only — not a broader
      // order-status race refactor.
      const claimed = await tx.order.updateMany({
        where: { id: enquiryId, quoteSelectionCompletedAt: null },
        data: {
          status: newStatus,
          selectedSupplierId,
          bestPriceTotal,
          // RFQ Accepted-Total Synchronization: Order.totalAmount is set at
          // enquiry-creation time from the catalogue/listing price (see
          // apps/web/lib/order-checkout.ts createOrdersFromCart /
          // apps/api/src/builder/orders/orders.service.ts create) and was
          // never previously updated once supplier quotes were accepted —
          // leaving it stale relative to the actual accepted commercial
          // value whenever a winning SupplierQuote.unitPrice differs from
          // the original catalogue price. `bestPriceTotal` above is already
          // computed as Σ(winningLine.unitPrice × quantity) over the exact
          // same `winningLines` whose unitPrice is written onto each
          // OrderItem immediately below, so it IS the accepted,
          // GST-exclusive order total by construction — reusing it here
          // (rather than deriving a second figure) keeps `totalAmount` and
          // `bestPriceTotal` equal and consistent with the accepted
          // OrderItem rows, inside this same transaction. Existing
          // AdvanceReservation/PaymentVerification/CustomerAdvanceTransaction
          // rows are immutable, stored Decimal snapshots and are
          // deliberately NOT touched here — only the next
          // computeOrderOutstandingAmount() call (apps/web/lib/
          // order-outstanding.ts) will read the corrected totalAmount.
          totalAmount: bestPriceTotal,
          tentativeDeliveryDate,
          quoteSelectionCompletedAt: new Date(),
          // Product-Level GST / GST-Inclusive Buyer Payable — frozen
          // snapshot at the SAME moment/transaction as the pricing
          // finalization above. See Order.taxAmount's schema doc comment:
          // all four fields are set together, never partially.
          taxAmount: snapshot.taxAmount,
          finalPayableAmount: snapshot.finalPayableAmount,
          advancePercent: snapshot.advancePercent,
          requiredAdvanceAmount: snapshot.requiredAdvanceAmount,
        },
      });

      // Concurrency guard: zero rows affected means a concurrent request
      // already claimed this order between our initial read and this
      // write — abort the whole transaction (Prisma rolls back every
      // statement in this callback) rather than proceeding to write
      // OrderItem/SupplierQuote rows for a confirmation we did not
      // actually win.
      if (claimed.count === 0) {
        throw new ConcurrentConfirmationLostError(enquiryId);
      }

      for (const line of winningLines) {
        const lineSnapshot = snapshotByLineItemId.get(line.lineItemId);
        await tx.orderItem.update({
          where: { id: line.lineItemId },
          data: {
            unitPrice: line.unitPrice,
            supplierId: line.supplierId,
            // Admin-Configurable Product Markup — frozen snapshot of the
            // original supplier price + applied markup at the exact moment
            // the buyer-facing price is set. See OrderItem's schema doc
            // comment: these are never recomputed from a later admin
            // configuration change.
            supplierUnitPrice: line.supplierUnitPrice,
            markupPercent: line.markupPercent,
            markupAmount: line.markupAmount,
            // Product-Level GST — this line's own resolved rate/amount,
            // frozen at the same moment. See OrderItem.taxRatePercent's
            // schema doc comment.
            taxRatePercent: lineSnapshot?.taxRatePercent ?? null,
            taxAmount: lineSnapshot?.taxAmount ?? null,
          },
        });

        // Mirror the same buyer-facing snapshot onto the winning
        // SupplierQuote row for traceability (see SupplierQuote's schema
        // doc comment) — its own `unitPrice` remains untouched (the
        // supplier's original quotation).
        await tx.supplierQuote.updateMany({
          where: { lineItemId: line.lineItemId, supplierId: line.supplierId },
          data: {
            buyerUnitPrice: line.unitPrice,
            markupPercent: line.markupPercent,
            markupAmount: line.markupAmount,
          },
        });
      }
    }).catch(async (error) => {
      if (error instanceof ConcurrentConfirmationLostError) {
        // Lost the race — a concurrent request already finalized this
        // order inside its own transaction (which committed first). Treat
        // this exactly like the quoteSelectionCompletedAt idempotency
        // check at the top of this method: re-read fresh and return the
        // winner's result rather than surfacing an error, retrying the
        // write ourselves, or sending a second round of notifications for
        // a transition this request did not actually cause.
        this.logger.warn(`Lost the confirmation race for enquiry ${enquiryId} to a concurrent request.`);
        const finalized = await this.prisma.order.findUnique({
          where: { id: enquiryId },
          include: { items: { select: { id: true, taxRatePercent: true, taxAmount: true } } },
        });
        if (!finalized) throw error;
        // Validate the WINNER's full snapshot integrity (order-level +
        // per-line) before trusting it enough to return it as this
        // request's own result — a lost race must never blindly assume the
        // winning transaction produced a consistent result.
        assertFullOrderSnapshotIntegrity(
          enquiryId,
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
        return { lostRace: true as const, finalized };
      }
      throw error;
    });

    if (transactionResult && "lostRace" in transactionResult && transactionResult.lostRace) {
      const finalized = transactionResult.finalized;
      return {
        enquiryId,
        selectedSupplierId: finalized.selectedSupplierId,
        selectedSupplierName: null,
        bestPriceTotal: Number(finalized.bestPriceTotal ?? 0),
        tentativeDeliveryDate: finalized.tentativeDeliveryDate ?? finalized.deliveryDate ?? new Date(),
        lineItems: [],
        finalized: false,
      };
    }

    // Notification Engine — customer_order_status WhatsApp template. Only a
    // real PLACED -> PROCESSING transition fires here — a re-run against an
    // enquiry already past PLACED leaves status unchanged, which
    // `notifyIfTransitioned` treats as a no-op (previousStatus === newStatus).
    // Scheduled via Vercel's waitUntil() — apps/api runs as a Vercel
    // serverless function, so a detached `void` promise is not guaranteed
    // to finish before the instance is frozen after the HTTP response is
    // sent (see apps/supplier/lib/supplier-data.ts for the full
    // explanation of the production issue this fixes).
    waitUntil(
      this.customerOrderStatusNotificationService
        .notifyIfTransitioned({ orderId: enquiryId, previousStatus, newStatus })
        .catch((error) => {
          this.logger.warn(
            `Failed to send customer_order_status notification for order ${enquiryId}: ${error instanceof Error ? error.message : String(error)}`
          );
        })
    );

    // Notification Engine — payment_required WhatsApp template
    // (PAYMENT_REQUIRED event). This is the de facto "payment now required"
    // business event in this codebase — see
    // packages/db/lib/payment-required-notification.ts's top doc comment for
    // the full audit. `notifyIfTransitioned` itself re-checks
    // Order.paymentStatus === PENDING fresh from the DB, so this is a safe
    // no-op if the order is somehow already paid. Scheduled via Vercel's
    // waitUntil() for the same reliability reason as the notification above.
    waitUntil(
      this.paymentRequiredNotificationService
        .notifyIfTransitioned({ orderId: enquiryId, previousStatus, newStatus })
        .catch((error) => {
          this.logger.warn(
            `Failed to send payment_required notification for order ${enquiryId}: ${error instanceof Error ? error.message : String(error)}`
          );
        })
    );

    // Price-discovery snapshot hook (additive, non-blocking): this is the
    // de facto "RFQ quote accepted" event in the codebase — capture one
    // PriceSnapshot row per winning line item at the accepted unit price.
    // Never blocks/affects the finalization above on failure.
    void this.recordRfqAcceptedSnapshots(enquiryId, order.items, winningLines).catch((error) => {
      this.logger.warn(
        `Failed to record RFQ-accepted price snapshots for enquiry ${enquiryId}: ${error instanceof Error ? error.message : String(error)}`
      );
    });

    return {

      enquiryId,
      selectedSupplierId,
      selectedSupplierName: selectedSupplierProfile?.companyName ?? null,
      bestPriceTotal,
      tentativeDeliveryDate,
      lineItems: winningLines,
      finalized: true,
      snapshot,
    };
  }

  /**
   * Price-discovery snapshot writer (additive, insert-only, non-blocking).
   * Inserts one PriceSnapshot row per winning line item at the moment an
   * RFQ enquiry's supplier quotes are finalized/accepted (source:
   * RFQ_ACCEPTED). Deliberately kept out of the read/hot path — only ever
   * invoked here, right after the Order.update finalization above.
   */
  private async recordRfqAcceptedSnapshots(
    enquiryId: string,
    items: Array<{ id: string; productId: string; product: { canonicalProductId: string | null } }>,
    winningLines: Array<BestLineItemSelection>
  ): Promise<void> {
    const itemsById = new Map(items.map((item) => [item.id, item]));

    // Batch-fetch each winning supplier's region so it can be tagged onto the
    // resulting PriceSnapshot rows (used by the Regional Price Comparison
    // report). Nullable/additive — suppliers without a region simply won't
    // contribute to regional grouping.
    const distinctSupplierIds = Array.from(new Set(winningLines.map((line) => line.supplierId)));
    const supplierProfiles = await this.prisma.supplierProfile.findMany({
      where: { id: { in: distinctSupplierIds } },
      select: { id: true, region: true },
    });
    const regionBySupplierId = new Map(supplierProfiles.map((profile) => [profile.id, profile.region]));

    for (const line of winningLines) {
      const item = itemsById.get(line.lineItemId);
      if (!item) {
        continue;
      }

      await this.prisma.priceSnapshot.create({
        data: {
          productId: item.productId,
          supplierId: line.supplierId,
          canonicalProductId: item.product.canonicalProductId ?? undefined,
          // Admin-Configurable Product Markup: price-discovery/market
          // intelligence (regional price comparison, trend reports) must
          // reflect the real SUPPLIER market price, never the buyer's
          // marked-up figure — using `unitPrice` (post-markup) here would
          // silently inflate every downstream market-price report by the
          // platform's own margin. `supplierUnitPrice` falls back to
          // `unitPrice` only if markup resolution was unavailable (see the
          // 0%-fallback case above, where the two are equal anyway).
          price: line.supplierUnitPrice,
          currency: line.currency,
          region: regionBySupplierId.get(line.supplierId) ?? undefined,
          source: "RFQ_ACCEPTED",
          sourceRefId: enquiryId,
        },
      });
    }
  }

  private resolveTentativeDeliveryDate(params: {

    requestedDate: Date | null;
    quoteLeadTimes: Array<number | null | undefined>;
    createdAt: Date;
  }): Date {
    if (params.requestedDate) {
      return params.requestedDate;
    }

    const leadTimeDays = Math.max(
      ...params.quoteLeadTimes.map((value) => (typeof value === "number" && value > 0 ? value : 0)),
      0
    );

    const fallbackDays = this.resolvePositiveNumber(process.env.DEFAULT_LEAD_TIME_DAYS, 3);
    const effectiveDays = leadTimeDays > 0 ? leadTimeDays : fallbackDays;

    const tentative = new Date(params.createdAt);
    tentative.setDate(tentative.getDate() + effectiveDays);
    return tentative;
  }

  private resolvePositiveNumber(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }

    return Math.floor(parsed);
  }
}
