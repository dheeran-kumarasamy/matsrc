import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  generateInvoiceNumber,
  calculateLineGst,
  calculateLineTaxSplit,
  getStateCode,
  getStateName,
  normalizeUqc,
  numberToIndianWords,
  roundCurrency,
  assertFullOrderSnapshotIntegrity,
  InconsistentOrderSnapshotError,
} from "@matsrc/db";
import { BUILDOHUB_COMPANY } from "src/common/company-info";
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
        items: { include: { product: { include: { supplier: true, unitRef: true } } } },
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
    const site = (order as any).site;
    const user = (order as any).user;
    const sellerStateCode = "33"; // BUILDOHUB_COMPANY (Tamil Nadu)
    const placeOfSupplyStateCode =
      getStateCode(user?.billingState, user?.gstin) ??
      getStateCode(site?.state, site?.gstin) ??
      "33";
    const placeOfSupplyStateName =
      user?.billingState ??
      site?.state ??
      getStateName(placeOfSupplyStateCode) ??
      "Tamil Nadu";

    const lineItems = supplierInvoice.lineItems.map((sli: any, index: number) => {
      const item = orderItemById.get(sli.orderItemId);
      const approvedUnitPrice = Number(sli.approvedUnitPrice);
      const shouldApplyMarkup = sli.applyMarkup !== false;
      const markupPercent =
        shouldApplyMarkup && item?.markupPercent !== null && item?.markupPercent !== undefined
          ? Number(item.markupPercent)
          : 0;
      const buyerUnitPrice = Math.round((approvedUnitPrice * (1 + markupPercent / 100) + Number.EPSILON) * 100) / 100;
      const markupAmount = Math.round((buyerUnitPrice - approvedUnitPrice + Number.EPSILON) * 100) / 100;

      const taxSplit = calculateLineTaxSplit({
        quantity: Number(sli.actualQuantity),
        unitPrice: buyerUnitPrice,
        gstRatePercent: sli.taxRatePercent !== null && sli.taxRatePercent !== undefined ? Number(sli.taxRatePercent) : null,
        sellerStateCode,
        placeOfSupplyStateCode,
      });

      const rawUnit = item?.product?.unitRef?.code || item?.product?.unit || null;
      const uqc = normalizeUqc(rawUnit);
      const hsnCode =
        item?.product?.hsnCode ??
        (item?.product?.name?.toLowerCase().includes("cement")
          ? "2523"
          : item?.product?.name?.toLowerCase().includes("steel") || item?.product?.name?.toLowerCase().includes("tmt")
            ? "7214"
            : "6810");

      return {
        slNo: index + 1,
        productId: (item?.productId as string) ?? null,
        productName: (item?.product?.name as string) ?? "Product",
        description: (item?.product?.description as string | null) ?? null,
        quantity: Number(sli.actualQuantity),
        unitPrice: new Prisma.Decimal(taxSplit.unitPrice.toString()),
        taxRate: taxSplit.gstRatePercent !== null ? new Prisma.Decimal(taxSplit.gstRatePercent.toString()) : null,
        taxAmount: new Prisma.Decimal(taxSplit.totalTaxAmount.toString()),
        subtotal: new Prisma.Decimal(taxSplit.taxableAmount.toString()),
        total: new Prisma.Decimal(taxSplit.lineTotal.toString()),
        // Form GST INV-01 / E-Invoice Item Compliance Fields (Phase 1 & 2)
        hsnCode,
        uqc,
        unit: rawUnit ?? "Unit",
        isService: false,
        taxableAmount: new Prisma.Decimal(taxSplit.taxableAmount.toString()),
        cgstRate: taxSplit.cgstRate > 0 ? new Prisma.Decimal(taxSplit.cgstRate.toString()) : null,
        cgstAmount: new Prisma.Decimal(taxSplit.cgstAmount.toString()),
        sgstRate: taxSplit.sgstRate > 0 ? new Prisma.Decimal(taxSplit.sgstRate.toString()) : null,
        sgstAmount: new Prisma.Decimal(taxSplit.sgstAmount.toString()),
        igstRate: taxSplit.igstRate > 0 ? new Prisma.Decimal(taxSplit.igstRate.toString()) : null,
        igstAmount: new Prisma.Decimal(taxSplit.igstAmount.toString()),
        cessRate: null,
        cessAmount: new Prisma.Decimal("0"),
        // Admin-Configurable Product Markup — reconciliation traceability.
        supplierUnitPrice: new Prisma.Decimal(approvedUnitPrice.toString()),
        markupPercent: new Prisma.Decimal(markupPercent.toString()),
        markupAmount: new Prisma.Decimal(markupAmount.toString()),
      };
    });

    const subtotal = lineItems.reduce((acc: Prisma.Decimal, li: (typeof lineItems)[number]) => acc.plus(li.subtotal), new Prisma.Decimal(0));
    const freightChargeAmount = new Prisma.Decimal(supplierInvoice.freightChargeAmount.toString());
    const otherChargesAmount = new Prisma.Decimal(supplierInvoice.otherChargesAmount.toString());
    const discountAmount = new Prisma.Decimal(supplierInvoice.discountAmount.toString());

    // Freight and other charges entered by Admin are exclusive of GST and attract 18% GST (Rule 46 & Form GST INV-01)
    const isIntraState = sellerStateCode === placeOfSupplyStateCode;
    let adjustmentCgst = new Prisma.Decimal(0);
    let adjustmentSgst = new Prisma.Decimal(0);
    let adjustmentIgst = new Prisma.Decimal(0);

    // If freight charges exist, add as a line item
    if (freightChargeAmount.greaterThan(0)) {
      const freightVal = freightChargeAmount.toNumber();
      let fCgst = 0;
      let fSgst = 0;
      let fIgst = 0;
      let fTax = 0;
      if (isIntraState) {
        fCgst = Math.round((freightVal * 0.09 + Number.EPSILON) * 100) / 100;
        fSgst = Math.round((freightVal * 0.09 + Number.EPSILON) * 100) / 100;
        fTax = fCgst + fSgst;
      } else {
        fIgst = Math.round((freightVal * 0.18 + Number.EPSILON) * 100) / 100;
        fTax = fIgst;
      }
      lineItems.push({
        slNo: lineItems.length + 1,
        productId: null,
        productName: "Freight charges",
        description: "road transport of goods",
        quantity: 1,
        unitPrice: freightChargeAmount,
        taxRate: new Prisma.Decimal("18.00"),
        taxAmount: new Prisma.Decimal(fTax.toString()),
        subtotal: freightChargeAmount,
        total: freightChargeAmount.plus(fTax),
        hsnCode: "996511",
        uqc: "OTH",
        unit: "OTH",
        isService: true,
        taxableAmount: freightChargeAmount,
        cgstRate: isIntraState ? new Prisma.Decimal("9.00") : null,
        cgstAmount: new Prisma.Decimal(fCgst.toString()),
        sgstRate: isIntraState ? new Prisma.Decimal("9.00") : null,
        sgstAmount: new Prisma.Decimal(fSgst.toString()),
        igstRate: !isIntraState ? new Prisma.Decimal("18.00") : null,
        igstAmount: new Prisma.Decimal(fIgst.toString()),
        cessRate: null,
        cessAmount: new Prisma.Decimal("0"),
        supplierUnitPrice: freightChargeAmount,
        markupPercent: new Prisma.Decimal("0"),
        markupAmount: new Prisma.Decimal("0"),
      });
      adjustmentCgst = adjustmentCgst.plus(fCgst);
      adjustmentSgst = adjustmentSgst.plus(fSgst);
      adjustmentIgst = adjustmentIgst.plus(fIgst);
    }

    // If other charges exist, add as a line item
    if (otherChargesAmount.greaterThan(0)) {
      const otherVal = otherChargesAmount.toNumber();
      let oCgst = 0;
      let oSgst = 0;
      let oIgst = 0;
      let oTax = 0;
      if (isIntraState) {
        oCgst = Math.round((otherVal * 0.09 + Number.EPSILON) * 100) / 100;
        oSgst = Math.round((otherVal * 0.09 + Number.EPSILON) * 100) / 100;
        oTax = oCgst + oSgst;
      } else {
        oIgst = Math.round((otherVal * 0.18 + Number.EPSILON) * 100) / 100;
        oTax = oIgst;
      }
      lineItems.push({
        slNo: lineItems.length + 1,
        productId: null,
        productName: "Other charges (loading / handling)",
        description: "loading / handling",
        quantity: 1,
        unitPrice: otherChargesAmount,
        taxRate: new Prisma.Decimal("18.00"),
        taxAmount: new Prisma.Decimal(oTax.toString()),
        subtotal: otherChargesAmount,
        total: otherChargesAmount.plus(oTax),
        hsnCode: "999799",
        uqc: "OTH",
        unit: "OTH",
        isService: true,
        taxableAmount: otherChargesAmount,
        cgstRate: isIntraState ? new Prisma.Decimal("9.00") : null,
        cgstAmount: new Prisma.Decimal(oCgst.toString()),
        sgstRate: isIntraState ? new Prisma.Decimal("9.00") : null,
        sgstAmount: new Prisma.Decimal(oSgst.toString()),
        igstRate: !isIntraState ? new Prisma.Decimal("18.00") : null,
        igstAmount: new Prisma.Decimal(oIgst.toString()),
        cessRate: null,
        cessAmount: new Prisma.Decimal("0"),
        supplierUnitPrice: otherChargesAmount,
        markupPercent: new Prisma.Decimal("0"),
        markupAmount: new Prisma.Decimal("0"),
      });
      adjustmentCgst = adjustmentCgst.plus(oCgst);
      adjustmentSgst = adjustmentSgst.plus(oSgst);
      adjustmentIgst = adjustmentIgst.plus(oIgst);
    }

    const linesTaxAmount = lineItems.reduce((acc: Prisma.Decimal, li: (typeof lineItems)[number]) => acc.plus(li.taxAmount), new Prisma.Decimal(0));
    const linesCgstAmount = lineItems.reduce((acc: Prisma.Decimal, li: (typeof lineItems)[number]) => acc.plus(li.cgstAmount), new Prisma.Decimal(0));
    const linesSgstAmount = lineItems.reduce((acc: Prisma.Decimal, li: (typeof lineItems)[number]) => acc.plus(li.sgstAmount), new Prisma.Decimal(0));
    const linesIgstAmount = lineItems.reduce((acc: Prisma.Decimal, li: (typeof lineItems)[number]) => acc.plus(li.igstAmount), new Prisma.Decimal(0));

    const cgstAmount = linesCgstAmount;
    const sgstAmount = linesSgstAmount;
    const igstAmount = linesIgstAmount;
    const taxAmount = linesTaxAmount;

    const taxableValue = subtotal.plus(freightChargeAmount).plus(otherChargesAmount).minus(discountAmount);
    const unroundedTotal = taxableValue.plus(taxAmount);
    const roundedTotal = Math.round(unroundedTotal.toNumber());
    const roundingAdjustment = new Prisma.Decimal((roundedTotal - unroundedTotal.toNumber()).toFixed(2));
    const totalAmount = new Prisma.Decimal(roundedTotal.toString());

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
            // Form GST INV-01 / E-Invoice & GST Compliance Fields (Phase 1 & 2)
            documentType: "INV",
            supplyType: "B2B",
            reverseCharge: false,
            placeOfSupplyStateCode,
            placeOfSupplyStateName,
            sellerStateCode,
            cgstAmount,
            sgstAmount,
            igstAmount,
            cessAmount: new Prisma.Decimal(0),
            buyerLegalName: user?.legalName ?? user?.name ?? site?.name ?? "Contractor/Client",
            buyerTradeName: user?.tradeName ?? site?.name ?? null,
            buyerGstin: user?.gstin ?? site?.gstin ?? "URP",
            buyerAddressLine: user?.billingAddress ?? site?.addressLine ?? null,
            buyerCity: user?.billingCity ?? site?.city ?? null,
            buyerState: user?.billingState ?? site?.state ?? null,
            buyerPincode: user?.billingPincode ?? site?.pincode ?? null,
            buyerStateCode: placeOfSupplyStateCode,
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
            paymentDueDays:
              supplierInvoice.paymentDueDays !== null && supplierInvoice.paymentDueDays !== undefined
                ? supplierInvoice.paymentDueDays
                : user?.paymentDueDays ?? 0,
            paymentDueDate: (() => {
              const dueDays =
                supplierInvoice.paymentDueDays !== null && supplierInvoice.paymentDueDays !== undefined
                  ? supplierInvoice.paymentDueDays
                  : user?.paymentDueDays ?? 0;
              return dueDays > 0 ? new Date(now.getTime() + dueDays * 24 * 60 * 60 * 1000) : null;
            })(),
            generatedById: actorId,
            generatedAt: now,
            lineItems: {
              create: lineItems.map((li: (typeof lineItems)[number]) => ({
                slNo: li.slNo,
                productId: li.productId,
                productName: li.productName,
                description: li.description,
                quantity: li.quantity,
                unitPrice: li.unitPrice,
                taxRate: li.taxRate,
                taxAmount: li.taxAmount,
                subtotal: li.subtotal,
                total: li.total,
                hsnCode: li.hsnCode,
                uqc: li.uqc,
                unit: li.unit,
                isService: li.isService,
                taxableAmount: li.taxableAmount,
                cgstRate: li.cgstRate,
                cgstAmount: li.cgstAmount,
                sgstRate: li.sgstRate,
                sgstAmount: li.sgstAmount,
                igstRate: li.igstRate,
                igstAmount: li.igstAmount,
                cessRate: li.cessRate,
                cessAmount: li.cessAmount,
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
      builder: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          legalName: true,
          tradeName: true,
          gstin: true,
          billingAddress: true,
          billingCity: true,
          billingState: true,
          billingPincode: true,
          paymentDueDays: true,
        },
      },
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

    const sellerStateCode = invoice.sellerStateCode ?? "33";
    const placeOfSupplyStateCode =
      invoice.placeOfSupplyStateCode ??
      invoice.buyerStateCode ??
      getStateCode(invoice.site?.state, invoice.site?.gstin) ??
      "33";
    const placeOfSupplyStateName =
      invoice.placeOfSupplyStateName ??
      invoice.site?.state ??
      getStateName(placeOfSupplyStateCode) ??
      "Tamil Nadu";
    const isIntraState = sellerStateCode === placeOfSupplyStateCode;

    const rawSubtotal = Number(invoice.subtotal ?? 0);
    const freightChargeAmount = Number(invoice.freightChargeAmount ?? 0);
    const otherChargesAmount = Number(invoice.otherChargesAmount ?? 0);
    const discountAmount = Number(invoice.discountAmount ?? 0);
    const roundingAdjustment = Number(invoice.roundingAdjustment ?? 0);
    const netAdjustment = freightChargeAmount + otherChargesAmount - discountAmount;
    const taxableValue =
      invoice.taxableValue !== null && invoice.taxableValue !== undefined
        ? Number(invoice.taxableValue)
        : rawSubtotal + netAdjustment;

    let totalTaxAmount = Number(invoice.taxAmount);
    let cgstTotal = Number(invoice.cgstAmount ?? 0);
    let sgstTotal = Number(invoice.sgstAmount ?? 0);
    let igstTotal = Number(invoice.igstAmount ?? 0);

    if (cgstTotal === 0 && sgstTotal === 0 && igstTotal === 0 && totalTaxAmount > 0) {
      if (isIntraState) {
        cgstTotal = Math.round((totalTaxAmount / 2 + Number.EPSILON) * 100) / 100;
        sgstTotal = Math.round((totalTaxAmount - cgstTotal + Number.EPSILON) * 100) / 100;
      } else {
        igstTotal = totalTaxAmount;
      }
    }

    const totalAmount = Number(invoice.totalAmount);

    const buyer = {
      legalName: invoice.buyerLegalName ?? (invoice.builder as any)?.legalName ?? invoice.builder?.name ?? "Contractor/Client",
      tradeName: invoice.buyerTradeName ?? (invoice.builder as any)?.tradeName ?? invoice.site?.name ?? null,
      gstin: invoice.buyerGstin ?? (invoice.builder as any)?.gstin ?? invoice.site?.gstin ?? "URP",
      addressLine: invoice.buyerAddressLine ?? (invoice.builder as any)?.billingAddress ?? invoice.site?.addressLine ?? null,
      city: invoice.buyerCity ?? (invoice.builder as any)?.billingCity ?? invoice.site?.city ?? null,
      state: invoice.buyerState ?? (invoice.builder as any)?.billingState ?? invoice.site?.state ?? null,
      pincode: invoice.buyerPincode ?? (invoice.builder as any)?.billingPincode ?? invoice.site?.pincode ?? null,
      stateCode: invoice.buyerStateCode ?? placeOfSupplyStateCode,
    };

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      status: invoice.status,
      documentType: invoice.documentType ?? "INV",
      supplyType: invoice.supplyType ?? "B2B",
      reverseCharge: Boolean(invoice.reverseCharge),
      placeOfSupplyStateCode,
      placeOfSupplyStateName,
      sellerStateCode,
      orderId: invoice.orderId,
      enquiryId: invoice.enquiryId ?? invoice.order?.enquiryId ?? invoice.orderId,
      builder: invoice.builder
        ? { id: invoice.builder.id, name: invoice.builder.name, email: invoice.builder.email, phone: invoice.builder.phone }
        : null,
      buyer,
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
      lineItems: (invoice.lineItems ?? []).map((li: any, index: number) => {
        const lineTaxRate = li.taxRate !== null && li.taxRate !== undefined ? Number(li.taxRate) : null;
        const lineTaxAmount = Number(li.taxAmount);
        let lineCgst = Number(li.cgstAmount ?? 0);
        let lineSgst = Number(li.sgstAmount ?? 0);
        let lineIgst = Number(li.igstAmount ?? 0);

        if (lineCgst === 0 && lineSgst === 0 && lineIgst === 0 && lineTaxAmount > 0) {
          if (isIntraState) {
            lineCgst = Math.round((lineTaxAmount / 2 + Number.EPSILON) * 100) / 100;
            lineSgst = Math.round((lineTaxAmount - lineCgst + Number.EPSILON) * 100) / 100;
          } else {
            lineIgst = lineTaxAmount;
          }
        }

        const hsnCode =
          li.hsnCode ??
          (li.productName?.toLowerCase().includes("cement")
            ? "2523"
            : li.productName?.toLowerCase().includes("steel") || li.productName?.toLowerCase().includes("tmt")
              ? "7214"
              : "6810");

        const roundedLineTotal = Math.round(Number(li.total));

        return {
          id: li.id,
          slNo: li.slNo ?? index + 1,
          productId: li.productId,
          productName: li.productName,
          description: li.description,
          hsnCode,
          uqc: li.uqc ?? "OTH",
          unit: li.unit ?? "Unit",
          isService: Boolean(li.isService),
          quantity: Number(li.quantity),
          unitPrice: Number(li.unitPrice),
          taxableAmount:
            li.taxableAmount !== null && li.taxableAmount !== undefined
              ? Number(li.taxableAmount)
              : Number(li.subtotal),
          taxRate: lineTaxRate,
          cgstRate:
            li.cgstRate !== null && li.cgstRate !== undefined
              ? Number(li.cgstRate)
              : isIntraState && lineTaxRate !== null
                ? lineTaxRate / 2
                : null,
          cgstAmount: lineCgst,
          sgstRate:
            li.sgstRate !== null && li.sgstRate !== undefined
              ? Number(li.sgstRate)
              : isIntraState && lineTaxRate !== null
                ? lineTaxRate / 2
                : null,
          sgstAmount: lineSgst,
          igstRate:
            li.igstRate !== null && li.igstRate !== undefined
              ? Number(li.igstRate)
              : !isIntraState && lineTaxRate !== null
                ? lineTaxRate
                : null,
          igstAmount: lineIgst,
          taxAmount: lineTaxAmount,
          subtotal: Number(li.subtotal),
          total: roundedLineTotal,
          // Admin-Configurable Product Markup — platform gross-markup
          // reconciliation traceability, admin-only (see includeMarkupDetail
          // above). Null for invoices generated before this feature existed
          // (see InvoiceLineItem's schema doc comment) or when the caller is
          // not authorized to see it.
          ...(includeMarkupDetail
            ? {
                supplierUnitPrice:
                  li.supplierUnitPrice !== null && li.supplierUnitPrice !== undefined
                    ? Number(li.supplierUnitPrice)
                    : null,
                markupPercent:
                  li.markupPercent !== null && li.markupPercent !== undefined ? Number(li.markupPercent) : null,
                markupAmount:
                  li.markupAmount !== null && li.markupAmount !== undefined ? Number(li.markupAmount) : null,
              }
            : {}),
        };
      }),
      subtotal: Number(invoice.subtotal),
      // Invoice-level adjustments — surfaced explicitly (audit fix) so the
      // displayed line items + adjustments + tax visibly reconcile to
      // totalAmount, rather than an invisible gap between subtotal and the
      // sum of the line items. `taxableValue` falls back to `subtotal` for
      // historical invoices generated before this field existed (where
      // subtotal already WAS the taxable value, since no adjustment fields
      // existed yet — see Invoice.taxableValue's schema doc comment).
      freightChargeAmount,
      otherChargesAmount,
      discountAmount,
      roundingAdjustment,
      taxableValue,
      cgstAmount: cgstTotal,
      sgstAmount: sgstTotal,
      igstAmount: igstTotal,
      cessAmount: Number(invoice.cessAmount ?? 0),
      taxAmount: totalTaxAmount,
      totalAmount: Math.round(totalAmount),
      totalInWords: numberToIndianWords(Math.round(totalAmount)),
      currency: invoice.currency,
      paymentStatus: invoice.paymentStatus,
      amountPaid: invoice.amountPaid !== null && invoice.amountPaid !== undefined ? Number(invoice.amountPaid) : null,
      amountDue: invoice.amountDue !== null && invoice.amountDue !== undefined ? Number(invoice.amountDue) : null,
      paymentDueDays:
        invoice.paymentDueDays !== null && invoice.paymentDueDays !== undefined
          ? Number(invoice.paymentDueDays)
          : invoice.builder?.paymentDueDays !== null && invoice.builder?.paymentDueDays !== undefined
            ? Number(invoice.builder.paymentDueDays)
            : 0,
      paymentDueDate: invoice.paymentDueDate ? new Date(invoice.paymentDueDate).toISOString() : null,
      paymentDueBy: (() => {
        const dueDays =
          invoice.paymentDueDays !== null && invoice.paymentDueDays !== undefined
            ? Number(invoice.paymentDueDays)
            : invoice.builder?.paymentDueDays !== null && invoice.builder?.paymentDueDays !== undefined
              ? Number(invoice.builder.paymentDueDays)
              : 0;
        if (invoice.paymentDueDate) {
          return new Date(invoice.paymentDueDate).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
        }
        if (dueDays > 0) {
          const baseDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date();
          const dueDate = new Date(baseDate.getTime() + dueDays * 24 * 60 * 60 * 1000);
          return dueDate.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
        }
        return "Immediate";
      })(),
      bankDetails: BUILDOHUB_COMPANY.bankDetails,
      buyerPoNumber: invoice.buyerPoNumber ?? null,
      ewayBillNumber: invoice.ewayBillNumber ?? null,
      vehicleNumber: invoice.vehicleNumber ?? null,
      transporterName: invoice.transporterName ?? null,
      generatedBy: invoice.generatedBy
        ? { id: invoice.generatedBy.id, name: invoice.generatedBy.name, email: invoice.generatedBy.email }
        : null,
      generatedAt: invoice.generatedAt,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }
}
