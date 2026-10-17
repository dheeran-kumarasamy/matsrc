import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { resolveSupplierInvoiceLine, aggregateSupplierInvoiceTotals, roundCurrency } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { ReviewSupplierInvoiceLineItemsDto } from "./dto/review-line-items.dto";
import { RecordSupplierPaymentDto } from "./dto/record-supplier-payment.dto";

// Minimal Supplier Payment Tracking — comparison epsilon for the
// "amount exceeds remaining outstanding balance" check, mirroring the
// existing RECONCILIATION_TOLERANCE convention elsewhere in this codebase
// (apps/api/src/admin/invoices/invoices.service.ts) — one cent, matching
// this schema's Decimal(12,2) precision. Prevents a legitimate
// penny-rounding difference from being rejected as "excessive".
const PAYMENT_TOLERANCE = 0.01;

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

// Resolves the authoritative, human-readable unit label for an OrderItem's
// product — the SAME fields every other supplier/admin surface already
// displays (Product.unit, the deprecated-but-still-populated free-text
// field; falling back to Product.unitRef.code/name, the newer FK-backed
// master-data unit, only when `unit` is empty). Never inferred from the
// product name or any other heuristic. Returns null only when the product
// genuinely has neither field populated, in which case the review UI shows
// "Unit not recorded" rather than fabricating one.
function resolveOrderUnitLabel(product: { unit?: string | null; unitRef?: { name: string; code: string } | null } | null | undefined): string | null {
  if (!product) return null;
  if (product.unit && product.unit.trim()) return product.unit.trim();
  if (product.unitRef?.code) return product.unitRef.code;
  if (product.unitRef?.name) return product.unitRef.name;
  return null;
}

// Admin review/confirmation of supplier-uploaded invoices (Step B/C/D of
// the Supplier Invoice Upload / Admin Verification / Buyer Invoice
// Generation workflow). Mirrors
// apps/api/src/admin/advance-payments/advance-payments.service.ts's
// find/approve/reject pattern (same idempotency guarantees, same atomic-
// transaction + audit-log shape) — the SupplierInvoice.status transition
// to CONFIRMED is the ONLY thing that may ever authorize
// InvoicesService.generate() to read this row (see that service's own
// eligibility check).
@Injectable()
export class SupplierInvoicesService {
  private readonly logger = new Logger(SupplierInvoicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(status?: "PENDING_REVIEW" | "REJECTED" | "CONFIRMED") {
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: status ? { status } : undefined,
      include: {
        order: { select: { id: true, enquiryId: true, orderNumber: true } },
        supplier: { select: { id: true, companyName: true } },
      },
      orderBy: { uploadedAt: "desc" },
    });

    return invoices.map((invoice) => this.serializeSummary(invoice));
  }

  async findOne(id: string) {
    const invoice = await this.loadDetail(id);
    return this.serializeDetail(invoice);
  }

  // Streams the raw, ORIGINAL supplier-invoice bytes to an authorized admin
  // only — never a public/static URL. Mirrors
  // AdvancePaymentsService.getScreenshot exactly.
  async getFile(id: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({
      where: { id },
      select: { fileData: true, fileMimeType: true, fileName: true },
    });
    if (!invoice) {
      throw new NotFoundException("Supplier invoice not found");
    }
    return invoice as { fileData: Buffer; fileMimeType: string; fileName: string };
  }

  private async loadDetail(id: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            enquiryId: true,
            orderNumber: true,
            items: {
              select: {
                id: true,
                quantity: true,
                unitPrice: true,
                taxRatePercent: true,
                // Unit display/validation (audit fix): `product.unit` is
                // the SAME authoritative free-text unit field every other
                // supplier/admin surface already reads for display (see
                // apps/supplier/lib/supplier-data.ts's extensive existing
                // use of `product.unit` for order/listing quantity labels)
                // — never inferred from the product name, never a new
                // field. `product.unitRef` is also a authoritative display
                // unit (Unit.name/code), used only as a fallback when the
                // deprecated free-text `unit` is somehow empty.
                product: { select: { name: true, unit: true, unitRef: { select: { name: true, code: true } } } },
              },
            },
          },
        },
        supplier: { select: { id: true, companyName: true, region: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        lineItems: { include: { orderItem: { include: { product: { select: { name: true, unit: true, unitRef: { select: { name: true, code: true } } } } } } } },
      },
    });
    if (!invoice) {
      throw new NotFoundException("Supplier invoice not found");
    }
    return invoice;
  }

  // Admin rejection — requests a replacement/correction from the supplier.
  // An already-CONFIRMED invoice can never be rejected (see model doc
  // comment); correction after confirmation is a separate, unimplemented
  // process (see this feature's Final Report). Idempotent: rejecting an
  // already-REJECTED invoice again just updates the reason/timestamp.
  async reject(id: string, actorId: string, reason: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new NotFoundException("Supplier invoice not found");
    }
    if (invoice.status === "CONFIRMED") {
      throw new BadRequestException("An already-confirmed supplier invoice cannot be rejected");
    }

    const now = new Date();
    const updated = await this.prisma.$transaction([
      this.prisma.supplierInvoice.update({
        where: { id },
        data: { status: "REJECTED", rejectedAt: now, rejectedBy: actorId, rejectionReason: reason },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: "SUPPLIER_INVOICE_REJECTED",
          entityType: "SupplierInvoice",
          entityId: id,
          metadata: { reason, orderId: invoice.orderId },
        },
      }),
    ]);

    return this.serializeSummary({ ...updated[0], order: null, supplier: null } as any);
  }

  // Admin enters/reviews the ACTUAL invoiced quantities/weights and
  // commercial values per line (Step C). Does NOT confirm — this can be
  // called repeatedly while status is PENDING_REVIEW to iterate before the
  // explicit confirm() call. Never callable once CONFIRMED (the snapshot is
  // immutable from that point on).
  //
  // Concurrency safety (audit fix): a plain `findUnique` re-check INSIDE a
  // `$transaction` is NOT sufficient to prevent a race against a
  // concurrently-committing confirm() call — Prisma's default Postgres
  // transaction isolation is READ COMMITTED, so two transactions can both
  // read status=PENDING_REVIEW, and whichever commits last silently wins,
  // even if the other already transitioned the row to CONFIRMED in the
  // meantime. The outer pre-check below is therefore only a fast-path
  // rejection for the common case; the AUTHORITATIVE guard is the
  // `SELECT ... FOR UPDATE` row lock taken inside the transaction further
  // down (mirrors lockAdvanceAccountRow's established convention in
  // packages/db/lib/advance-ledger.ts), which blocks until any concurrent
  // confirm()/reviewLineItems() transaction on the SAME row has committed
  // or rolled back, and then re-reads the now-current status before any
  // write — so a review can never commit against a row that a concurrent
  // confirm() has already finalized.
  async reviewLineItems(id: string, dto: ReviewSupplierInvoiceLineItemsDto) {
    const invoice = await this.prisma.supplierInvoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new NotFoundException("Supplier invoice not found");
    }
    if (invoice.status === "CONFIRMED") {
      throw new BadRequestException("A confirmed supplier invoice cannot be re-reviewed");
    }

    const orderItemIds = dto.lines.map((line) => line.orderItemId);
    const orderItems = await this.prisma.orderItem.findMany({
      where: { id: { in: orderItemIds }, orderId: invoice.orderId },
      select: {
        id: true,
        quantity: true,
        unitPrice: true,
        // Admin-Configurable Product Markup — the ORIGINAL supplier rate
        // Buildohub agreed to pay, preserved separately from the buyer's
        // marked-up `unitPrice` (see OrderItem's schema doc comment). This
        // supplier-invoice reconciliation workflow exists to verify what
        // the SUPPLIER actually invoiced against the agreed SUPPLIER rate
        // — it must never compare against the buyer's selling price.
        supplierUnitPrice: true,
        taxRatePercent: true,
        // Unit display/validation (audit fix): same authoritative fields
        // used in loadDetail()'s include — see that method's doc comment.
        product: { select: { unit: true, unitRef: { select: { name: true, code: true } } } },
      },
    });
    const orderItemById = new Map(orderItems.map((item) => [item.id, item]));

    if (orderItems.length !== orderItemIds.length) {
      throw new BadRequestException("One or more line items do not belong to this order");
    }

    let hasDiscrepancy = false;

    const resolvedLines = dto.lines.map((line) => {
      const orderItem = orderItemById.get(line.orderItemId)!;
      // Admin-Configurable Product Markup: falls back to orderItem.unitPrice
      // only for legacy pre-migration rows with no recorded
      // supplierUnitPrice (implicit 0% markup) — never the buyer's
      // marked-up price for a row that DOES have a recorded supplier rate.
      const originalUnitPrice =
        orderItem.supplierUnitPrice !== null && orderItem.supplierUnitPrice !== undefined
          ? toNumber(orderItem.supplierUnitPrice)
          : toNumber(orderItem.unitPrice);
      const resolution = resolveSupplierInvoiceLine({
        originalQuantity: orderItem.quantity,
        originalUnitPrice,
        actualQuantity: line.actualQuantity,
        supplierInvoicedUnitPrice: line.supplierInvoicedUnitPrice ?? null,
        approvedUnitPriceOverride: line.approvedUnitPriceOverride ?? null,
        taxRatePercent: line.taxRatePercent ?? (orderItem.taxRatePercent ? toNumber(orderItem.taxRatePercent) : null),
      });
      if (resolution.rateDiscrepancy) {
        hasDiscrepancy = true;
      }
      return { line, orderItem, originalUnitPrice, resolution };
    });

    const totals = aggregateSupplierInvoiceTotals(
      resolvedLines.map((r) => r.resolution),
      {
        freightChargeAmount: dto.freightChargeAmount,
        otherChargesAmount: dto.otherChargesAmount,
        discountAmount: dto.discountAmount,
        roundingAdjustment: dto.roundingAdjustment,
      }
    );

    await this.prisma.$transaction(async (tx) => {
      // AUTHORITATIVE concurrency guard — see this method's doc comment.
      // Row-locks the SupplierInvoice row (blocking until any concurrent
      // confirm()/reviewLineItems() transaction on it has committed or
      // rolled back), then re-reads status from that locked row. A
      // confirm() that commits first will have already set status to
      // CONFIRMED by the time this lock is granted, so this check reliably
      // observes it — unlike a plain (non-locking) re-read, which could
      // still race under READ COMMITTED isolation.
      const lockedRows = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "SupplierInvoice" WHERE "id" = ${id} FOR UPDATE`;
      const lockedStatus = lockedRows[0]?.status;
      if (!lockedStatus) {
        throw new NotFoundException("Supplier invoice not found");
      }
      if (lockedStatus === "CONFIRMED") {
        throw new BadRequestException("A confirmed supplier invoice cannot be re-reviewed");
      }

      for (const { line, orderItem, originalUnitPrice, resolution } of resolvedLines) {
        await tx.supplierInvoiceLineItem.upsert({
          where: { supplierInvoiceId_orderItemId: { supplierInvoiceId: id, orderItemId: line.orderItemId } },
          create: {
            supplierInvoiceId: id,
            orderItemId: line.orderItemId,
            originalQuantity: orderItem.quantity,
            // Admin-Configurable Product Markup: the agreed SUPPLIER rate
            // (see the resolvedLines computation above), never the buyer's
            // marked-up OrderItem.unitPrice.
            originalUnitPrice,
            orderUnitLabel: resolveOrderUnitLabel((orderItem as any).product),
            unitConfirmed: line.unitConfirmed ?? false,
            actualQuantity: line.actualQuantity,
            approvedUnitPrice: resolution.approvedUnitPrice,
            supplierInvoicedUnitPrice: line.supplierInvoicedUnitPrice ?? null,
            rateDiscrepancy: resolution.rateDiscrepancy,
            taxRatePercent: resolution.taxRatePercent,
            lineSubtotal: resolution.lineSubtotal,
            lineTaxAmount: resolution.lineTaxAmount,
            lineTotal: resolution.lineTotal,
          },
          update: {
            orderUnitLabel: resolveOrderUnitLabel((orderItem as any).product),
            unitConfirmed: line.unitConfirmed ?? false,
            actualQuantity: line.actualQuantity,
            approvedUnitPrice: resolution.approvedUnitPrice,
            supplierInvoicedUnitPrice: line.supplierInvoicedUnitPrice ?? null,
            rateDiscrepancy: resolution.rateDiscrepancy,
            taxRatePercent: resolution.taxRatePercent,
            lineSubtotal: resolution.lineSubtotal,
            lineTaxAmount: resolution.lineTaxAmount,
            lineTotal: resolution.lineTotal,
          },
        });
      }

      await tx.supplierInvoice.update({
        where: { id },
        data: {
          freightChargeAmount: dto.freightChargeAmount ?? 0,
          otherChargesAmount: dto.otherChargesAmount ?? 0,
          discountAmount: dto.discountAmount ?? 0,
          roundingAdjustment: dto.roundingAdjustment ?? 0,
          confirmedTaxableValue: totals.taxableValue,
          confirmedTaxAmount: totals.taxAmount,
          confirmedTotalAmount: totals.totalAmount,
          hasDiscrepancy,
          discrepancyNotes: dto.discrepancyNotes ?? invoice.discrepancyNotes,
        },
      });
    });

    return this.findOne(id);
  }

  // Minimal Supplier Payment Tracking — returns the confirmed invoice's
  // total, aggregate paid amount, outstanding balance, computed status,
  // and the full payment history. Available for ANY invoice (not just
  // CONFIRMED ones) so the admin UI can show "not yet confirmed — no
  // payments possible" rather than a 404/error, but confirmedTotal/status
  // are only meaningful once CONFIRMED (see serializePaymentSummary).
  async getPaymentSummary(id: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({
      where: { id },
      include: { payments: { orderBy: { paymentDate: "desc" } } },
    });
    if (!invoice) {
      throw new NotFoundException("Supplier invoice not found");
    }
    return this.serializePaymentSummary(invoice);
  }

  // Minimal Supplier Payment Tracking — records a single MANUALLY executed
  // supplier payment (e.g. a bank transfer the company already made
  // outside Buildohub) against a CONFIRMED SupplierInvoice. This method
  // never initiates, approves, or reverses a payment itself — it only
  // durably records what the admin reports was already paid, mirroring
  // SupplierInvoicesService.confirm's authorization/locking pattern
  // exactly (same `SELECT ... FOR UPDATE` row lock, same $transaction +
  // auditLog.create shape).
  async recordPayment(id: string, actorId: string, dto: RecordSupplierPaymentDto) {
    const admin = await this.prisma.user.findUnique({ where: { id: actorId } });
    if (!admin || (admin.role !== "ADMIN" && admin.role !== "SUPER_ADMIN")) {
      throw new ForbiddenException("Only an Admin can record a supplier payment");
    }

    // Reject invalid amounts before the transaction even opens — the DTO's
    // own @IsPositive() already rejects 0/negative/NaN/non-numeric input
    // at the validation-pipe boundary; this is a defence-in-depth re-check
    // for any caller that bypasses the pipe.
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException("Payment amount must be a positive number");
    }

    const paymentDate = new Date(dto.paymentDate);
    if (Number.isNaN(paymentDate.getTime())) {
      throw new BadRequestException("Invalid payment date");
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      // SELECT ... FOR UPDATE on the SupplierInvoice row — mirrors
      // confirm()'s identical lock exactly. This achieves genuine mutual
      // exclusion between two concurrent "Record Payment" submissions (and
      // between a concurrent payment + confirm/reject), so two requests
      // racing to record a payment can never both read the same
      // "remaining balance" and together overpay the invoice.
      const lockedRows = await tx.$queryRaw<{ status: string; confirmedTotalAmount: string | null }[]>`
        SELECT "status", "confirmedTotalAmount" FROM "SupplierInvoice" WHERE "id" = ${id} FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new NotFoundException("Supplier invoice not found");
      }
      if (locked.status !== "CONFIRMED" || locked.confirmedTotalAmount === null) {
        throw new BadRequestException("Only a confirmed supplier invoice is eligible for payment recording");
      }

      const confirmedTotal = toNumber(locked.confirmedTotalAmount);

      // Re-read the current paid total INSIDE the same locked transaction
      // — never from a stale read taken before the lock was acquired, so
      // a payment committed by a concurrent request (now blocked behind
      // this lock, or already committed before it) is always reflected
      // here before this request decides whether to accept its own amount.
      const existingPayments = await tx.supplierPayment.findMany({
        where: { supplierInvoiceId: id },
        select: { amount: true },
      });
      const alreadyPaid = roundCurrency(existingPayments.reduce((sum, p) => sum + toNumber(p.amount), 0));
      const remaining = roundCurrency(confirmedTotal - alreadyPaid);

      if (dto.amount > remaining + PAYMENT_TOLERANCE) {
        throw new BadRequestException(
          `Payment amount (₹${dto.amount.toLocaleString("en-IN")}) exceeds the remaining outstanding balance (₹${remaining.toLocaleString("en-IN")})`
        );
      }

      const created = await tx.supplierPayment.create({
        data: {
          supplierInvoiceId: id,
          amount: dto.amount,
          paymentDate,
          paymentMethod: dto.paymentMethod ?? null,
          paymentReference: dto.paymentReference ?? null,
          remarks: dto.remarks ?? null,
          recordedBy: actorId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "SUPPLIER_PAYMENT_RECORDED",
          entityType: "SupplierInvoice",
          entityId: id,
          metadata: {
            supplierPaymentId: created.id,
            amount: dto.amount,
            paymentMethod: dto.paymentMethod ?? null,
            paymentReference: dto.paymentReference ?? null,
          },
        },
      });

      return created;
    });

    this.logger.log(`Recorded supplier payment ${payment.id} of ₹${dto.amount} against invoice ${id}`);

    return this.getPaymentSummary(id);
  }

  // Minimal Supplier Payment Tracking — single place amount-paid/
  // outstanding-balance/status are derived. Never reads a stored
  // "balance" column (none exists) and never allows a caller to supply
  // these values directly — always SUM(payments) vs. confirmedTotalAmount.
  private serializePaymentSummary(invoice: any) {
    const confirmedTotalAmount =
      invoice.confirmedTotalAmount !== null && invoice.confirmedTotalAmount !== undefined
        ? toNumber(invoice.confirmedTotalAmount)
        : null;

    const payments = (invoice.payments ?? []).map((p: any) => ({
      id: p.id,
      amount: toNumber(p.amount),
      paymentDate: p.paymentDate,
      paymentMethod: p.paymentMethod,
      paymentReference: p.paymentReference,
      remarks: p.remarks,
      recordedBy: p.recordedBy,
      createdAt: p.createdAt,
    }));

    const amountPaid = roundCurrency(payments.reduce((sum: number, p: any) => sum + p.amount, 0));

    // Status/outstanding balance are only meaningful once the invoice is
    // CONFIRMED (confirmedTotalAmount is the only authoritative total this
    // workflow ever produces). A PENDING_REVIEW/REJECTED invoice always
    // reports a null outstanding balance/status rather than fabricating a
    // total from unconfirmed data.
    const outstandingBalance = confirmedTotalAmount !== null ? roundCurrency(confirmedTotalAmount - amountPaid) : null;

    let paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" | null = null;
    if (confirmedTotalAmount !== null) {
      if (amountPaid <= PAYMENT_TOLERANCE) {
        paymentStatus = "UNPAID";
      } else if (outstandingBalance !== null && outstandingBalance <= PAYMENT_TOLERANCE) {
        paymentStatus = "PAID";
      } else {
        paymentStatus = "PARTIALLY_PAID";
      }
    }

    return {
      supplierInvoiceId: invoice.id,
      invoiceStatus: invoice.status,
      confirmedTotalAmount,
      amountPaid,
      outstandingBalance,
      paymentStatus,
      payments,
    };
  }

  // Admin confirmation (Step D) — the explicit authorization to generate
  // the BuildOhub buyer invoice. Requires at least one reviewed line item
  // (reviewLineItems must have been called first) and every order item to
  // have a reviewed line. Idempotent: a repeat call for an already-
  // CONFIRMED invoice returns the existing confirmed state unchanged
  // rather than re-computing/overwriting it (mirrors
  // AdvancePaymentsService.approve's idempotent early-return pattern).
  async confirm(id: string, actorId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: actorId } });
    if (!admin || (admin.role !== "ADMIN" && admin.role !== "SUPER_ADMIN")) {
      throw new ForbiddenException("Only an Admin can confirm a supplier invoice");
    }

    const invoice = await this.prisma.supplierInvoice.findUnique({
      where: { id },
      include: { lineItems: true, order: { include: { items: true } } },
    });
    if (!invoice) {
      throw new NotFoundException("Supplier invoice not found");
    }

    if (invoice.status === "CONFIRMED") {
      return this.findOne(id);
    }

    if (invoice.lineItems.length === 0) {
      throw new BadRequestException("Enter the actual invoiced quantities/values before confirming");
    }
    if (invoice.lineItems.length !== invoice.order.items.length) {
      throw new BadRequestException("Every order line item must be reviewed before confirming");
    }
    if (
      invoice.confirmedTaxableValue === null ||
      invoice.confirmedTaxAmount === null ||
      invoice.confirmedTotalAmount === null
    ) {
      throw new BadRequestException("Review totals are incomplete — re-submit the line-item review before confirming");
    }

    // Unit-of-measure validation (audit fix): every reviewed line must have
    // the admin's explicit unitConfirmed acknowledgment before an invoice
    // can be confirmed — there is no automatic way to detect a genuine
    // unit mismatch (e.g. tonnes entered against a kg-denominated order)
    // from an opaque uploaded document, so the system requires the human
    // reviewer to have explicitly checked this rather than silently
    // treating every actualQuantity entry as same-unit by default.
    const unconfirmedUnitLines = invoice.lineItems.filter((li: any) => !li.unitConfirmed);
    if (unconfirmedUnitLines.length > 0) {
      throw new BadRequestException(
        "Confirm that the entered quantity uses the same unit as the order for every line before confirming"
      );
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Re-check inside the transaction to close the race window — two
      // concurrent "Confirm" clicks must never both pass the outer check.
      //
      // Concurrency safety (audit fix): takes the SAME `SELECT ... FOR
      // UPDATE` row lock reviewLineItems() now takes, so the two methods
      // achieve genuine mutual exclusion on this row — a plain (non-locking)
      // findUnique re-check here would not, by itself, block a concurrent
      // reviewLineItems() transaction that is still in flight (both would
      // simply read whatever was last committed under READ COMMITTED
      // isolation, with no ordering guarantee between them). With both
      // sides taking this lock, whichever transaction starts first holds
      // the lock until it commits/rolls back, and the other blocks until
      // then and re-reads the now-current status.
      const lockedRows = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "SupplierInvoice" WHERE "id" = ${id} FOR UPDATE`;
      const lockedStatus = lockedRows[0]?.status;
      if (!lockedStatus || lockedStatus === "CONFIRMED") {
        return;
      }

      await tx.supplierInvoice.update({
        where: { id },
        data: { status: "CONFIRMED", confirmedAt: now, confirmedBy: actorId },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "SUPPLIER_INVOICE_CONFIRMED",
          entityType: "SupplierInvoice",
          entityId: id,
          metadata: {
            orderId: invoice.orderId,
            confirmedTotalAmount: invoice.confirmedTotalAmount?.toString(),
            hasDiscrepancy: invoice.hasDiscrepancy,
          },
        },
      });
    });

    return this.findOne(id);
  }


  private serializeSummary(invoice: any) {
    return {
      id: invoice.id,
      orderId: invoice.orderId,
      enquiryId: invoice.order?.enquiryId ?? invoice.orderId,
      orderNumber: invoice.order?.orderNumber ?? null,
      supplier: invoice.supplier ? { id: invoice.supplier.id, companyName: invoice.supplier.companyName } : null,
      status: invoice.status,
      fileName: invoice.fileName,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
      supplierInvoiceDate: invoice.supplierInvoiceDate,
      uploadedAt: invoice.uploadedAt,
      hasDiscrepancy: invoice.hasDiscrepancy,
      confirmedTotalAmount:
        invoice.confirmedTotalAmount !== null && invoice.confirmedTotalAmount !== undefined
          ? toNumber(invoice.confirmedTotalAmount)
          : null,
      fileUrl: `/api/admin/supplier-invoices/${invoice.id}/file`,
    };
  }

  private serializeDetail(invoice: any) {
    return {
      ...this.serializeSummary(invoice),
      purchaseOrder: invoice.purchaseOrder ? { id: invoice.purchaseOrder.id, poNumber: invoice.purchaseOrder.poNumber } : null,
      // The order's own line items — used by the Admin review UI to
      // initialize a draft review form (original quantity/rate) BEFORE any
      // SupplierInvoiceLineItem exists yet. Never itself the confirmed
      // snapshot (see `lineItems` below for that).
      orderItems: (invoice.order?.items ?? []).map((item: any) => ({
        id: item.id,
        productName: item.product?.name ?? null,
        // Unit display (audit fix) — see resolveOrderUnitLabel's doc
        // comment for the authoritative-field precedence this uses.
        unitLabel: resolveOrderUnitLabel(item.product),
        quantity: item.quantity,
        unitPrice: toNumber(item.unitPrice),
        taxRatePercent: item.taxRatePercent !== null && item.taxRatePercent !== undefined ? toNumber(item.taxRatePercent) : null,
      })),
      freightChargeAmount: toNumber(invoice.freightChargeAmount),
      otherChargesAmount: toNumber(invoice.otherChargesAmount),
      discountAmount: toNumber(invoice.discountAmount),
      roundingAdjustment: toNumber(invoice.roundingAdjustment),
      confirmedTaxableValue:
        invoice.confirmedTaxableValue !== null && invoice.confirmedTaxableValue !== undefined
          ? toNumber(invoice.confirmedTaxableValue)
          : null,
      confirmedTaxAmount:
        invoice.confirmedTaxAmount !== null && invoice.confirmedTaxAmount !== undefined
          ? toNumber(invoice.confirmedTaxAmount)
          : null,
      discrepancyNotes: invoice.discrepancyNotes,
      rejectionReason: invoice.rejectionReason,
      confirmedAt: invoice.confirmedAt,
      confirmedBy: invoice.confirmedBy,
      lineItems: (invoice.lineItems ?? []).map((li: any) => ({
        id: li.id,
        orderItemId: li.orderItemId,
        productName: li.orderItem?.product?.name ?? null,
        // Unit display/validation (audit fix). `orderUnitLabel` is the
        // FROZEN snapshot taken at review time (never re-derived from live
        // product data afterwards); `unitConfirmed` is the admin's explicit
        // per-line acknowledgment required before confirm() will accept
        // this invoice (see confirm()'s own guard).
        orderUnitLabel: li.orderUnitLabel ?? resolveOrderUnitLabel(li.orderItem?.product),
        unitConfirmed: li.unitConfirmed,
        originalQuantity: li.originalQuantity,
        originalUnitPrice: toNumber(li.originalUnitPrice),
        actualQuantity: toNumber(li.actualQuantity),
        approvedUnitPrice: toNumber(li.approvedUnitPrice),
        supplierInvoicedUnitPrice:
          li.supplierInvoicedUnitPrice !== null && li.supplierInvoicedUnitPrice !== undefined
            ? toNumber(li.supplierInvoicedUnitPrice)
            : null,
        rateDiscrepancy: li.rateDiscrepancy,
        taxRatePercent: li.taxRatePercent !== null && li.taxRatePercent !== undefined ? toNumber(li.taxRatePercent) : null,
        lineSubtotal: toNumber(li.lineSubtotal),
        lineTaxAmount: toNumber(li.lineTaxAmount),
        lineTotal: toNumber(li.lineTotal),
      })),
    };
  }
}
