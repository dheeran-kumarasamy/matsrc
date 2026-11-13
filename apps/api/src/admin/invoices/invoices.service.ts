import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  generateInvoiceNumber,
  calculateLineGst,
  roundCurrency,
  assertFullOrderSnapshotIntegrity,
  InconsistentOrderSnapshotError,
} from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

// Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B) —
// tolerance for comparing two already-independently-rounded currency
// figures (the buyer invoice's own computed total/tax vs. the frozen
// Order.finalPayableAmount/taxAmount snapshot). Mirrors the identical
// CURRENCY_TOLERANCE convention already used by
// packages/db/lib/order-confirmation-snapshot.ts's own arithmetic
// validators — one cent, matching this schema's Decimal(12,2) precision.
// This is a COMPARISON epsilon only, never a new rounding/calculation rule.
const RECONCILIATION_TOLERANCE = 0.01;

// Invoice Generation & Management — Admin-only.
//
// Business rule (see project spec): only an Admin/Super Admin may generate
// an invoice, and only after:
//   1. The order exists.
//   2. The order is NOT cancelled.
//   3. The order's bank-transfer payment has been verified/approved by an
//      Admin (PaymentVerification.status === APPROVED) — this is the exact
//      same gate PaymentsService.approve already enforces before moving
//      Order.paymentStatus to PAID, so "payment verified" here means
//      Order.paymentStatus === PAID, never merely PENDING_VERIFICATION
//      (i.e. a payment screenshot upload alone is NEVER sufficient).
//   4. The order has at least one line item to invoice.
//   5. Supplier Invoice Upload / Admin Verification workflow: the order's
//      SupplierInvoice (see apps/api/src/admin/supplier-invoices) must be
//      CONFIRMED — i.e. an Admin has uploaded-and-reviewed the supplier's
//      own invoice, entered the ACTUAL invoiced quantities/weights and
//      commercial values, and explicitly confirmed them. Uploading a
//      supplier invoice alone (PENDING_REVIEW/REJECTED) is never
//      sufficient — only SupplierInvoicesService.confirm() satisfies this.
//   6. No invoice already exists for the order (idempotent — a repeat call
//      simply returns the existing invoice instead of creating a duplicate).
//
// Financial values are read from the CONFIRMED SupplierInvoice/
// SupplierInvoiceLineItem snapshot (actual invoiced quantity x approved
// rate, plus the admin-reviewed freight/discount/rounding adjustments) —
// never accepted from the caller/frontend, never recomputed from live
// OrderItem/Product pricing — and frozen into Invoice/InvoiceLineItem rows
// that are themselves never recomputed again afterwards.
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B) — pure,
  // side-effect-free comparison between what this invoice is ABOUT TO bill
  // the buyer (computed from the confirmed SupplierInvoice, see generate()'s
  // own doc comment on why that computation is independent from the frozen
  // Order snapshot) and the authoritative, frozen Order.finalPayableAmount/
  // taxAmount snapshot written at supplier/payment confirmation time (see
  // packages/db/lib/order-confirmation-snapshot.ts). Returns null when the
  // two reconcile within RECONCILIATION_TOLERANCE — the ordinary,
  // no-discrepancy path. Never called for a legacy order (frozenPayable
  // null) — see generate()'s own guard, which skips this entirely for that
  // case rather than fabricating a historical payable to compare against.
  private computeReconciliationDiscrepancy(
    computed: { totalAmount: number; taxAmount: number },
    frozen: { finalPayableAmount: number; taxAmount: number }
  ): { expectedPayable: number; calculatedPayable: number; expectedTax: number; calculatedTax: number; reason: string } | null {
    const payableDiff = roundCurrency(computed.totalAmount - frozen.finalPayableAmount);
    const taxDiff = roundCurrency(computed.taxAmount - frozen.taxAmount);

    if (Math.abs(payableDiff) <= RECONCILIATION_TOLERANCE && Math.abs(taxDiff) <= RECONCILIATION_TOLERANCE) {
      return null;
    }

    const reasons: string[] = [];
    if (Math.abs(payableDiff) > RECONCILIATION_TOLERANCE) {
      reasons.push(
        `Calculated buyer payable (₹${computed.totalAmount}) differs from the frozen order payable (₹${frozen.finalPayableAmount}) by ₹${payableDiff}.`
      );
    }
    if (Math.abs(taxDiff) > RECONCILIATION_TOLERANCE) {
      reasons.push(
        `Calculated GST (₹${computed.taxAmount}) differs from the frozen order GST (₹${frozen.taxAmount}) by ₹${taxDiff}.`
      );
    }

    return {
      expectedPayable: frozen.finalPayableAmount,
      calculatedPayable: computed.totalAmount,
      expectedTax: frozen.taxAmount,
      calculatedTax: computed.taxAmount,
      reason: reasons.join(" "),
    };
  }

  // Single source of truth for "can this order have an invoice generated
  // right now" — used by both generate() (server-side enforcement) and the
  // Admin order detail read path (to decide whether to surface the
  // "Generate Invoice" action at all). Never relies on the frontend alone.
  async checkEligibility(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: { include: { supplier: true } } } },
        site: true,
        user: true,
        invoice: true,
        supplierInvoice: { include: { lineItems: true, supplier: { select: { region: true } } } },
      },
    });

    if (!order) {
      return { eligible: false as const, reason: "Order not found", order: null };
    }

    if (order.invoice) {
      return { eligible: false as const, reason: "An invoice already exists for this order", order };
    }

    if (order.status === OrderStatus.CANCELLED) {
      return { eligible: false as const, reason: "A cancelled order cannot be invoiced", order };
    }

    // "Payment verified" == the same PAID transition PaymentsService.approve
    // performs after an Admin approves the bank-transfer proof. A payment
    // still PENDING_VERIFICATION (screenshot uploaded, not yet reviewed) or
    // PENDING/FAILED/REFUNDED is never sufficient on its own.
    if (order.paymentStatus !== PaymentStatus.PAID) {
      return { eligible: false as const, reason: "Payment for this order has not yet been verified by an Admin", order };
    }

    if (!order.items || order.items.length === 0) {
      return { eligible: false as const, reason: "This order has no line items to invoice", order };
    }

    for (const item of order.items) {
      if (!item.product?.supplier) {
        return { eligible: false as const, reason: "This order is missing required supplier data", order };
      }
    }

    // Supplier Invoice Upload / Admin Verification gate — the supplier must
    // have uploaded their own invoice AND an Admin must have reviewed +
    // explicitly CONFIRMED the actual invoiced quantities/values before a
    // BuildOhub buyer invoice can be generated. See SupplierInvoicesService
    // for the upload/review/confirm lifecycle this reads.
    if (!order.supplierInvoice) {
      return { eligible: false as const, reason: "The supplier has not yet uploaded an invoice for this order", order };
    }
    if (order.supplierInvoice.status !== "CONFIRMED") {
      return {
        eligible: false as const,
        reason: "The supplier invoice has not yet been reviewed and confirmed by an Admin",
        order,
      };
    }

    return { eligible: true as const, reason: undefined as string | undefined, order };
  }

  // Admin-only Generate Invoice action. Authorization (ADMIN/SUPER_ADMIN
  // role) is enforced by the controller's RoleGuard — this method further
  // re-validates every other eligibility condition server-side so a request
  // can never bypass them by manipulating the frontend.
  async generate(orderId: string, actorId: string) {
    const { eligible, reason, order } = await this.checkEligibility(orderId);

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    // Idempotent: an invoice already existing for this order is returned
    // as-is rather than treated as a hard failure — "Generate Invoice"
    // clicked twice (e.g. a double-click race) must never create a second
    // invoice or a second invoice number.
    if ((order as any).invoice) {
      return this.findByOrderId(orderId);
    }

    if (!eligible) {
      throw new BadRequestException(reason ?? "This order is not eligible for invoice generation");
    }

    const admin = await this.prisma.user.findUnique({ where: { id: actorId } });
    if (!admin || (admin.role !== "ADMIN" && admin.role !== "SUPER_ADMIN")) {
      // Defense in depth — RoleGuard already enforces this at the HTTP
      // layer, but the service must never trust the caller either.
      throw new ForbiddenException("Only an Admin can generate an invoice");
    }

    // Every OrderItem belongs to exactly one supplier in the current data
    // model (see OrderItem.supplierId) — an order with items split across
    // multiple suppliers should not normally occur (Order is created
    // per-supplier group, see order-checkout.ts), but guard against it
    // rather than silently picking one.
    const supplierIds = new Set(order.items.map((item: any) => item.supplierId));
    if (supplierIds.size > 1) {
      throw new BadRequestException("This order spans multiple suppliers and cannot be invoiced as a single document");
    }
    const supplierId = order.items[0].supplierId as string;

    // Frozen financial snapshot, built from the CONFIRMED
    // SupplierInvoiceLineItem rows (actual invoiced quantity x
    // admin-approved rate) — never from raw OrderItem pricing and never
    // accepted from the request body. checkEligibility() has already
    // guaranteed order.supplierInvoice.status === "CONFIRMED" at this point.
    const supplierInvoice = (order as any).supplierInvoice;
    const orderItemById = new Map(order.items.map((item: any) => [item.id, item]));

    // Admin-Configurable Product Markup — IMPORTANT, EXPLICITLY DOCUMENTED
    // ASSUMPTION requiring tax/accounting confirmation (see the investigation
    // report's "GST treatment must not be guessed" finding): the confirmed
    // SupplierInvoiceLineItem.approvedUnitPrice is the ADMIN-VERIFIED
    // SUPPLIER settlement rate (see SupplierInvoicesService's own fix —
    // originalUnitPrice/approvedUnitPrice are now sourced from
    // OrderItem.supplierUnitPrice, never the buyer's marked-up price). The
    // BUYER invoice must bill the marked-up selling price, not this raw
    // supplier rate — this implementation marks up `approvedUnitPrice` using
    // the ORIGINAL markup percentage frozen on the order at
    // checkout/acceptance time (OrderItem.markupPercent — never a
    // currently-configured admin percentage, so a later admin markup change
    // can never silently alter an already-confirmed invoice), then
    // RECOMPUTES GST on that marked-up taxable value. Computing GST on the
    // buyer-billed value (rather than the supplier settlement value) is the
    // only arithmetically consistent choice for an invoice addressed to the
    // buyer; which legal basis applies (Buildohub as principal vs. a
    // separate agent/commission invoice) is a distinct, UNRESOLVED
    // tax/accounting question this implementation does not decide — see the
    // Final Report's "tax/accounting decisions still requiring approval".
    const lineItems = supplierInvoice.lineItems.map((sli: any) => {
      const item = orderItemById.get(sli.orderItemId);
      const approvedUnitPrice = Number(sli.approvedUnitPrice);
      const markupPercent =
        item?.markupPercent !== null && item?.markupPercent !== undefined ? Number(item.markupPercent) : 0;
      const buyerUnitPrice = Math.round((approvedUnitPrice * (1 + markupPercent / 100) + Number.EPSILON) * 100) / 100;
      const markupAmount = Math.round((buyerUnitPrice - approvedUnitPrice + Number.EPSILON) * 100) / 100;

      const gst = calculateLineGst({
        quantity: Number(sli.actualQuantity),
        unitPrice: buyerUnitPrice,
        gstRatePercent: sli.taxRatePercent !== null && sli.taxRatePercent !== undefined ? Number(sli.taxRatePercent) : null,
      });

      return {
        productId: (item?.productId as string) ?? null,
        productName: (item?.product?.name as string) ?? "Product",
        description: (item?.product?.description as string | null) ?? null,
        quantity: Number(sli.actualQuantity),
        unitPrice: new Prisma.Decimal(gst.unitPrice.toString()),
        taxRate: gst.gstRatePercent !== null ? new Prisma.Decimal(gst.gstRatePercent.toString()) : null,
        taxAmount: new Prisma.Decimal(gst.gstAmount.toString()),
        subtotal: new Prisma.Decimal(gst.lineSubtotal.toString()),
        total: new Prisma.Decimal(gst.lineTotal.toString()),
        // Admin-Configurable Product Markup — reconciliation traceability.
        supplierUnitPrice: new Prisma.Decimal(approvedUnitPrice.toString()),
        markupPercent: new Prisma.Decimal(markupPercent.toString()),
        markupAmount: new Prisma.Decimal(markupAmount.toString()),
      };
    });

    // Audit fix (financial transparency): `subtotal` is the PURE sum of
    // this invoice's own line items — exactly what a reader gets by adding
    // up the line items shown on the document.
    //
    // Admin-Configurable Product Markup — IMPORTANT: taxableValue/taxAmount/
    // totalAmount are now computed from the BUYER-facing (marked-up) line
    // items above, NOT copied from supplierInvoice.confirmedTaxableValue/
    // confirmedTaxAmount/confirmedTotalAmount — those remain the SUPPLIER
    // settlement figures (admin-verified rate x actual quantity, before
    // markup) and are intentionally never asserted to equal the buyer
    // invoice's totals once a non-zero markup applies; the two are
    // DIFFERENT by design (the gap IS the platform's gross markup, per the
    // confirmed business model). Freight/other charges/discount/rounding
    // are operational pass-through adjustments (never themselves marked
    // up) and are added/subtracted identically to the previous behaviour.
    const subtotal = lineItems.reduce((acc: Prisma.Decimal, li: (typeof lineItems)[number]) => acc.plus(li.subtotal), new Prisma.Decimal(0));
    const freightChargeAmount = new Prisma.Decimal(supplierInvoice.freightChargeAmount.toString());
    const otherChargesAmount = new Prisma.Decimal(supplierInvoice.otherChargesAmount.toString());
    const discountAmount = new Prisma.Decimal(supplierInvoice.discountAmount.toString());
    const roundingAdjustment = new Prisma.Decimal(supplierInvoice.roundingAdjustment.toString());
    const taxAmount = lineItems.reduce((acc: Prisma.Decimal, li: (typeof lineItems)[number]) => acc.plus(li.taxAmount), new Prisma.Decimal(0));
    const taxableValue = subtotal.plus(freightChargeAmount).plus(otherChargesAmount).minus(discountAmount);
    const totalAmount = taxableValue.plus(taxAmount).plus(roundingAdjustment);

    // Payment snapshot — derived from the application's existing
    // PaymentStatus, taken at generation time only.
    const amountPaid = order.paymentStatus === PaymentStatus.PAID ? totalAmount : new Prisma.Decimal(0);
    const amountDue = totalAmount.minus(amountPaid);

    // Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B) —
    // authoritative policy: Order.finalPayableAmount/taxAmount (frozen at
    // supplier/payment confirmation time — see
    // packages/db/lib/order-confirmation-snapshot.ts) are the buyer's
    // actual, legally-owed payable/GST. A supplier-invoice rate override
    // (or any other adjustment captured on the confirmed SupplierInvoice)
    // may legitimately make the just-computed buyer invoice total/tax
    // differ from that frozen snapshot — this is NEVER silently allowed to
    // reprice the buyer or silently overwrite the frozen Order snapshot;
    // it is instead recorded as a durable, admin-visible reconciliation
    // discrepancy (see writeReconciliationDiscrepancy below) and the
    // invoice generation itself proceeds — see this method's own
    // doc comment and generate()'s "Important implementation boundary":
    // neither amount is ever altered, and no discrepancy is ever silently
    // marked resolved.
    //
    // Legacy orders (order.finalPayableAmount === null — this order was
    // never confirmed through a snapshot-writing path, or predates the GST
    // feature entirely) have no frozen GST-inclusive payable to compare
    // against; reconciliation is skipped entirely rather than fabricating
    // a historical payable from current configuration — the existing,
    // pre-Phase-5B invoice-generation behaviour for such orders is fully
    // preserved.
    //
    // A PARTIAL/INCONSISTENT snapshot (fails assertFullOrderSnapshotIntegrity)
    // is NEVER treated as "legacy" — it fails closed with a blocking error,
    // surfaced to the admin as a 400, rather than silently generating an
    // invoice against financial data already known to be corrupt.
    let reconciliationDiscrepancy: ReturnType<InvoicesService["computeReconciliationDiscrepancy"]> = null;
    // Loose null check (== rather than ===) — deliberately treats BOTH a
    // genuinely-null finalPayableAmount (a real legacy/unconfirmed order)
    // AND an undefined one (a caller/fixture that never set the field at
    // all) identically as "no frozen snapshot to reconcile against", since
    // Prisma itself never returns `undefined` for a selected scalar column
    // — only a caller that omitted the field from its include/select could
    // produce `undefined`, which must be treated exactly like `null` here,
    // never as "has a snapshot".
    const frozenFinalPayableAmount = order.finalPayableAmount == null ? null : Number(order.finalPayableAmount);
    if (frozenFinalPayableAmount !== null) {
      try {
        assertFullOrderSnapshotIntegrity(
          order.id,
          {
            totalAmount: Number(order.totalAmount),
            taxAmount: order.taxAmount !== null ? Number(order.taxAmount) : null,
            finalPayableAmount: frozenFinalPayableAmount,
            advancePercent: order.advancePercent !== null ? Number(order.advancePercent) : null,
            requiredAdvanceAmount: order.requiredAdvanceAmount !== null ? Number(order.requiredAdvanceAmount) : null,
          },
          order.items.map((item: any) => ({
            id: item.id,
            taxRatePercent: item.taxRatePercent !== null ? Number(item.taxRatePercent) : null,
            taxAmount: item.taxAmount !== null ? Number(item.taxAmount) : null,
          }))
        );
      } catch (error) {
        if (error instanceof InconsistentOrderSnapshotError) {
          // Fail closed — a partial/inconsistent snapshot must never be
          // treated as "legacy" or silently repaired by generating an
          // invoice against it.
          throw new BadRequestException(
            `Cannot generate an invoice: this order's financial snapshot is inconsistent (${error.message}). An Admin must investigate before an invoice can be generated.`
          );
        }
        throw error;
      }

      reconciliationDiscrepancy = this.computeReconciliationDiscrepancy(
        { totalAmount: totalAmount.toNumber(), taxAmount: taxAmount.toNumber() },
        { finalPayableAmount: frozenFinalPayableAmount, taxAmount: Number(order.taxAmount) }
      );
    }

    const now = new Date();

    const invoiceId = await this.prisma.$transaction(
      async (tx) => {
        // Re-check inside the transaction to close the race window between
        // the eligibility check above and this write — two concurrent
        // "Generate Invoice" clicks must never both pass the outer check
        // and then both attempt to create a row (the @@unique(orderId)
        // constraint below is the final backstop even if this check were
        // somehow skipped).
        const existing = await tx.invoice.findUnique({ where: { orderId } });
        if (existing) {
          return existing.id;
        }

        const invoiceNumber = await generateInvoiceNumber(tx as any, now);

        // Ship-from / ship-to snapshot — deliberately NEVER includes the
        // supplier's company name/identity (see the buyer-facing privacy
        // requirement). Ship-from falls back to the supplier's `region`
        // free-text field (no structured address exists on SupplierProfile
        // today — see this feature's Final Report) rather than fabricating
        // a city/state. Ship-to is the order's own Site address, exactly
        // like the Purchase Order PDF's existing "Deliver To" block.
        const site = (order as any).site;

        const created = await tx.invoice.create({
          data: {
            invoiceNumber,
            invoiceDate: now,
            orderId: order.id,
            enquiryId: order.enquiryId,
            builderId: order.userId,
            siteId: order.siteId,
            supplierId,
            supplierInvoiceId: supplierInvoice.id,
            shipFromState: supplierInvoice.supplier?.region ?? null,
            shipToAddressLine: site?.addressLine ?? null,
            shipToCity: site?.city ?? null,
            shipToState: site?.state ?? null,
            shipToPincode: site?.pincode ?? null,
            subtotal,
            taxableValue,
            freightChargeAmount,
            otherChargesAmount,
            discountAmount,
            roundingAdjustment,
            taxAmount,
            totalAmount,
            currency: "INR",
            paymentStatus: order.paymentStatus,
            amountPaid,
            amountDue,
            generatedById: actorId,
            generatedAt: now,
            lineItems: {
              create: lineItems.map((li: (typeof lineItems)[number]) => ({
                productId: li.productId,
                productName: li.productName,
                description: li.description,
                quantity: li.quantity,
                unitPrice: li.unitPrice,
                taxRate: li.taxRate,
                taxAmount: li.taxAmount,
                subtotal: li.subtotal,
                total: li.total,
                // Admin-Configurable Product Markup — reconciliation
                // traceability (see this method's doc comment above).
                supplierUnitPrice: li.supplierUnitPrice,
                markupPercent: li.markupPercent,
                markupAmount: li.markupAmount,
              })),
            },
          },
        });

        await tx.auditLog.create({
          data: {
            actorId,
            action: "INVOICE_GENERATED",
            entityType: "Invoice",
            entityId: created.id,
            metadata: {
              orderId: order.id,
              invoiceNumber: created.invoiceNumber,
              totalAmount: totalAmount.toString(),
            },
          },
        });

        // Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B) —
        // the durable, admin-visible discrepancy record. Written in the
        // SAME transaction as the Invoice row so a reconciliation
        // discrepancy can never exist without its invoice (or vice versa).
        // Uses the EXISTING, generic AuditLog model (no schema change) —
        // see this service's own doc comment above and the Final Report's
        // "exact admin-review mechanism used" for why no new model/field
        // was introduced: AuditService (apps/api/src/admin/audit) already
        // exposes a filterable GET /admin/audit?entityType=Invoice&
        // action=INVOICE_RECONCILIATION_DISCREPANCY read surface with zero
        // additional backend work, and this never marks itself "resolved"
        // (AuditLog rows are append-only/immutable — there is no mutable
        // status field here to silently flip). Never written for the
        // no-discrepancy (reconciled) path.
        if (reconciliationDiscrepancy) {
          await tx.auditLog.create({
            data: {
              actorId,
              action: "INVOICE_RECONCILIATION_DISCREPANCY",
              entityType: "Invoice",
              entityId: created.id,
              metadata: {
                orderId: order.id,
                invoiceNumber: created.invoiceNumber,
                expectedPayable: reconciliationDiscrepancy.expectedPayable,
                calculatedPayable: reconciliationDiscrepancy.calculatedPayable,
                expectedTax: reconciliationDiscrepancy.expectedTax,
                calculatedTax: reconciliationDiscrepancy.calculatedTax,
                reason: reconciliationDiscrepancy.reason,
              },
            },
          });
        }

        return created.id;
      },
      { maxWait: 10000, timeout: 15000 }
    );

    return this.findById(invoiceId);
  }

  // Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B) —
  // admin-only lookup of the durable discrepancy record (if any) written by
  // generate() alongside this invoice's own INVOICE_GENERATED entry (see
  // that method's doc comment). Returns null when the invoice reconciled
  // cleanly — the ordinary case — never a fabricated "no discrepancy"
  // placeholder distinct from "never checked".
  private async findReconciliationDiscrepancy(invoiceId: string) {
    const entry = await this.prisma.auditLog.findFirst({
      where: { entityType: "Invoice", entityId: invoiceId, action: "INVOICE_RECONCILIATION_DISCREPANCY" },
      orderBy: { createdAt: "desc" },
    });
    if (!entry) {
      return null;
    }
    const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
    return {
      flaggedAt: entry.createdAt,
      expectedPayable: metadata.expectedPayable ?? null,
      calculatedPayable: metadata.calculatedPayable ?? null,
      expectedTax: metadata.expectedTax ?? null,
      calculatedTax: metadata.calculatedTax ?? null,
      reason: metadata.reason ?? null,
    };
  }

  // Only ever called from generate() (admin-gated) — includes markup detail
  // for the same reason findByOrderId does (see that method's doc comment).
  async findById(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!invoice) {
      throw new NotFoundException("Invoice not found");
    }
    const reconciliationDiscrepancy = await this.findReconciliationDiscrepancy(invoice.id);
    return { ...this.serialize(invoice, { includeMarkupDetail: true }), reconciliationDiscrepancy };
  }

  // Admin-only read (see invoices.controller.ts's @Roles("ADMIN") guard).
  // Admin-Configurable Product Markup: `includeMarkupDetail: true` surfaces
  // supplierUnitPrice/markupPercent/markupAmount per line for platform
  // gross-markup reconciliation — NEVER passed when serializing for the
  // buyer (see findByOrderIdForUser below), since the buyer invoice must
  // never disclose Buildohub's own margin/supplier cost.
  async findByOrderId(orderId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { orderId },
      include: this.detailInclude(),
    });
    if (!invoice) {
      throw new NotFoundException("No invoice exists for this order");
    }
    // Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B) —
    // admin-only visibility, mirroring includeMarkupDetail's identical
    // gating: a reconciliation discrepancy exposes the platform's own
    // markup/supplier-settlement gap, which must never reach the buyer.
    const reconciliationDiscrepancy = await this.findReconciliationDiscrepancy(invoice.id);
    return { ...this.serialize(invoice, { includeMarkupDetail: true }), reconciliationDiscrepancy };
  }

  // Access-controlled read used by both the Admin app and the
  // Builder/Contractor app's own invoice view — the caller passes the
  // authenticated user's id/role and (for non-admins) ownership is
  // enforced here so financial information never leaks across accounts.
  async findByOrderIdForUser(orderId: string, userCtx: { id: string; role: string }) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { orderId },
      include: this.detailInclude(),
    });
    if (!invoice) {
      throw new NotFoundException("No invoice exists for this order");
    }

    const isAdmin = userCtx.role === "ADMIN" || userCtx.role === "SUPER_ADMIN";
    const isOwner = invoice.builderId === userCtx.id;
    if (!isAdmin && !isOwner) {
      throw new ForbiddenException("You do not have access to this invoice");
    }

    // Admin-Configurable Product Markup: only an admin caller (never the
    // buyer, even when viewing their own invoice) sees the markup
    // breakdown — see serialize()'s own doc comment.
    //
    // Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B): the
    // SAME admin-only gating applies to a reconciliation discrepancy (if
    // any) — it exposes the platform's own markup/supplier-settlement gap,
    // which must never reach the buyer even on their own invoice.
    const reconciliationDiscrepancy = isAdmin ? await this.findReconciliationDiscrepancy(invoice.id) : null;
    return { ...this.serialize(invoice, { includeMarkupDetail: isAdmin }), reconciliationDiscrepancy };
  }

  // NOTE: deliberately does NOT include `supplier` — the generated
  // BuildOhub buyer invoice must never disclose the supplier's identity
  // (name/GSTIN/contact) to the Contractor/Client, and an Admin reviewing
  // supplier details uses the separate Order/SupplierInvoice admin
  // endpoints instead (see SupplierInvoicesService). Ship-from/ship-to are
  // the invoice's own frozen address-only snapshot columns (see schema.prisma),
  // never re-derived from the live SupplierProfile here.
  private detailInclude() {
    return {
      order: { select: { id: true, enquiryId: true } },
      builder: { select: { id: true, name: true, email: true, phone: true } },
      site: { select: { id: true, name: true, addressLine: true, city: true, state: true, pincode: true, gstin: true } },
      generatedBy: { select: { id: true, name: true, email: true } },
      lineItems: true,
    } satisfies Prisma.InvoiceInclude;
  }


  // Admin-Configurable Product Markup: `includeMarkupDetail` gates whether
  // the per-line supplierUnitPrice/markupPercent/markupAmount
  // reconciliation fields are included. Defaults to false (safest default)
  // — only the explicit admin-only call sites above opt in. The buyer-
  // facing invoice document/PDF itself never reads these fields at all
  // (see invoice-pdf.util.ts's InvoicePdfData type, which has no markup
  // fields), but the JSON API response is additionally gated here as
  // defense in depth.
  private serialize(invoice: any, options: { includeMarkupDetail?: boolean } = {}) {
    const includeMarkupDetail = options.includeMarkupDetail ?? false;
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      status: invoice.status,
      orderId: invoice.orderId,
      enquiryId: invoice.enquiryId ?? invoice.order?.enquiryId ?? invoice.orderId,
      builder: invoice.builder
        ? { id: invoice.builder.id, name: invoice.builder.name, email: invoice.builder.email, phone: invoice.builder.phone }
        : null,
      site: invoice.site
        ? {
            id: invoice.site.id,
            name: invoice.site.name,
            addressLine: invoice.site.addressLine,
            city: invoice.site.city,
            state: invoice.site.state,
            pincode: invoice.site.pincode,
            gstin: invoice.site.gstin,
          }
        : null,
      // Ship-from/ship-to — never the supplier's identity (name/GSTIN/
      // contact), only location, per the buyer-facing privacy requirement.
      // See Invoice.shipFrom*/shipTo* in schema.prisma.
      shipFrom:
        invoice.shipFromAddressLine || invoice.shipFromCity || invoice.shipFromState || invoice.shipFromPincode
          ? {
              addressLine: invoice.shipFromAddressLine ?? null,
              city: invoice.shipFromCity ?? null,
              state: invoice.shipFromState ?? null,
              pincode: invoice.shipFromPincode ?? null,
            }
          : null,
      shipTo:
        invoice.shipToAddressLine || invoice.shipToCity || invoice.shipToState || invoice.shipToPincode
          ? {
              addressLine: invoice.shipToAddressLine ?? null,
              city: invoice.shipToCity ?? null,
              state: invoice.shipToState ?? null,
              pincode: invoice.shipToPincode ?? null,
            }
          : null,
      lineItems: (invoice.lineItems ?? []).map((li: any) => ({
        id: li.id,
        productId: li.productId,
        productName: li.productName,
        description: li.description,
        quantity: Number(li.quantity),
        unitPrice: Number(li.unitPrice),
        taxRate: li.taxRate !== null && li.taxRate !== undefined ? Number(li.taxRate) : null,
        taxAmount: Number(li.taxAmount),
        subtotal: Number(li.subtotal),
        total: Number(li.total),
        // Admin-Configurable Product Markup — platform gross-markup
        // reconciliation traceability, admin-only (see includeMarkupDetail
        // above). Null for invoices generated before this feature existed
        // (see InvoiceLineItem's schema doc comment) or when the caller is
        // not authorized to see it.
        ...(includeMarkupDetail
          ? {
              supplierUnitPrice: li.supplierUnitPrice !== null && li.supplierUnitPrice !== undefined ? Number(li.supplierUnitPrice) : null,
              markupPercent: li.markupPercent !== null && li.markupPercent !== undefined ? Number(li.markupPercent) : null,
              markupAmount: li.markupAmount !== null && li.markupAmount !== undefined ? Number(li.markupAmount) : null,
            }
          : {}),
      })),
      subtotal: Number(invoice.subtotal),
      // Invoice-level adjustments — surfaced explicitly (audit fix) so the
      // displayed line items + adjustments + tax visibly reconcile to
      // totalAmount, rather than an invisible gap between subtotal and the
      // sum of the line items. `taxableValue` falls back to `subtotal` for
      // historical invoices generated before this field existed (where
      // subtotal already WAS the taxable value, since no adjustment fields
      // existed yet — see Invoice.taxableValue's schema doc comment).
      freightChargeAmount: Number(invoice.freightChargeAmount ?? 0),
      otherChargesAmount: Number(invoice.otherChargesAmount ?? 0),
      discountAmount: Number(invoice.discountAmount ?? 0),
      roundingAdjustment: Number(invoice.roundingAdjustment ?? 0),
      taxableValue:
        invoice.taxableValue !== null && invoice.taxableValue !== undefined
          ? Number(invoice.taxableValue)
          : Number(invoice.subtotal),
      taxAmount: Number(invoice.taxAmount),
      totalAmount: Number(invoice.totalAmount),
      currency: invoice.currency,
      paymentStatus: invoice.paymentStatus,
      amountPaid: invoice.amountPaid !== null && invoice.amountPaid !== undefined ? Number(invoice.amountPaid) : null,
      amountDue: invoice.amountDue !== null && invoice.amountDue !== undefined ? Number(invoice.amountDue) : null,
      generatedBy: invoice.generatedBy
        ? { id: invoice.generatedBy.id, name: invoice.generatedBy.name, email: invoice.generatedBy.email }
        : null,
      generatedAt: invoice.generatedAt,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }
}
