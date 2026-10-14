import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OrderStatus, PaymentStatus, Prisma, generateInvoiceNumber } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

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

    const lineItems = supplierInvoice.lineItems.map((sli: any) => {
      const item = orderItemById.get(sli.orderItemId);
      const taxRate = sli.taxRatePercent !== null && sli.taxRatePercent !== undefined ? new Prisma.Decimal(sli.taxRatePercent.toString()) : null;

      return {
        productId: (item?.productId as string) ?? null,
        productName: (item?.product?.name as string) ?? "Product",
        description: (item?.product?.description as string | null) ?? null,
        quantity: Number(sli.actualQuantity),
        unitPrice: new Prisma.Decimal(sli.approvedUnitPrice.toString()),
        taxRate,
        taxAmount: new Prisma.Decimal(sli.lineTaxAmount.toString()),
        subtotal: new Prisma.Decimal(sli.lineSubtotal.toString()),
        total: new Prisma.Decimal(sli.lineTotal.toString()),
      };
    });

    // Audit fix (financial transparency): `subtotal` is now the PURE sum of
    // this invoice's own line items — exactly what a reader gets by adding
    // up the line items shown on the document — never the post-adjustment
    // `confirmedTaxableValue` (which silently folded in freight/other
    // charges/discount with no visible trace). The invoice-level
    // adjustments are copied verbatim as their own fields below, and
    // `taxableValue` records the post-adjustment figure explicitly so the
    // full chain (subtotal -> + adjustments -> taxableValue -> + tax ->
    // totalAmount) is reconstructable from stored data alone.
    const subtotal = lineItems.reduce((acc: Prisma.Decimal, li: (typeof lineItems)[number]) => acc.plus(li.subtotal), new Prisma.Decimal(0));
    const freightChargeAmount = new Prisma.Decimal(supplierInvoice.freightChargeAmount.toString());
    const otherChargesAmount = new Prisma.Decimal(supplierInvoice.otherChargesAmount.toString());
    const discountAmount = new Prisma.Decimal(supplierInvoice.discountAmount.toString());
    const roundingAdjustment = new Prisma.Decimal(supplierInvoice.roundingAdjustment.toString());
    const taxAmount = new Prisma.Decimal(supplierInvoice.confirmedTaxAmount.toString());
    // taxableValue/totalAmount are still read from the confirmed snapshot
    // (never re-derived here) as the authoritative source of truth — but we
    // also assert they reconcile with the itemized fields above, so a bug
    // in either computation surfaces immediately instead of silently
    // diverging again.
    const taxableValue = new Prisma.Decimal(supplierInvoice.confirmedTaxableValue.toString());
    const totalAmount = new Prisma.Decimal(supplierInvoice.confirmedTotalAmount.toString());

    const expectedTaxableValue = subtotal.plus(freightChargeAmount).plus(otherChargesAmount).minus(discountAmount);
    if (!expectedTaxableValue.equals(taxableValue)) {
      throw new BadRequestException(
        "The confirmed supplier invoice totals do not reconcile with its line items — re-review before confirming"
      );
    }

    // Payment snapshot — derived from the application's existing
    // PaymentStatus, taken at generation time only.
    const amountPaid = order.paymentStatus === PaymentStatus.PAID ? totalAmount : new Prisma.Decimal(0);
    const amountDue = totalAmount.minus(amountPaid);

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

        return created.id;
      },
      { maxWait: 10000, timeout: 15000 }
    );

    return this.findById(invoiceId);
  }

  async findById(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!invoice) {
      throw new NotFoundException("Invoice not found");
    }
    return this.serialize(invoice);
  }

  async findByOrderId(orderId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { orderId },
      include: this.detailInclude(),
    });
    if (!invoice) {
      throw new NotFoundException("No invoice exists for this order");
    }
    return this.serialize(invoice);
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

    return this.serialize(invoice);
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


  private serialize(invoice: any) {
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
