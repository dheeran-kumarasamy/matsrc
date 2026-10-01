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
//   5. No invoice already exists for the order (idempotent — a repeat call
//      simply returns the existing invoice instead of creating a duplicate).
//
// All financial values are read from the database (OrderItem rows) — never
// accepted from the caller/frontend — and frozen into Invoice/
// InvoiceLineItem rows that are never recomputed from live pricing again.
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

    // Frozen financial snapshot, computed server-side from the order's
    // final OrderItem rows — never from live Product/SupplierProfile
    // pricing, and never accepted from the request body.
    const lineItems = order.items.map((item: any) => {
      const unitPrice = new Prisma.Decimal(item.unitPrice.toString());
      const quantity = item.quantity as number;
      const taxRate = item.taxRatePercent ? new Prisma.Decimal(item.taxRatePercent.toString()) : null;
      const lineSubtotal = unitPrice.mul(quantity);
      const lineTax = taxRate ? lineSubtotal.mul(taxRate).div(100) : new Prisma.Decimal(0);
      const lineTotal = lineSubtotal.plus(lineTax);

      return {
        productId: item.productId as string,
        productName: (item.product?.name as string) ?? "Product",
        description: (item.product?.description as string | null) ?? null,
        quantity,
        unitPrice,
        taxRate,
        taxAmount: lineTax,
        subtotal: lineSubtotal,
        total: lineTotal,
      };
    });

    const subtotal = lineItems.reduce((acc, li) => acc.plus(li.subtotal), new Prisma.Decimal(0));
    const taxAmount = lineItems.reduce((acc, li) => acc.plus(li.taxAmount), new Prisma.Decimal(0));
    const totalAmount = subtotal.plus(taxAmount);

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

        const created = await tx.invoice.create({
          data: {
            invoiceNumber,
            invoiceDate: now,
            orderId: order.id,
            enquiryId: order.enquiryId,
            builderId: order.userId,
            siteId: order.siteId,
            supplierId,
            subtotal,
            taxAmount,
            totalAmount,
            currency: "INR",
            paymentStatus: order.paymentStatus,
            amountPaid,
            amountDue,
            generatedById: actorId,
            generatedAt: now,
            lineItems: {
              create: lineItems.map((li) => ({
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

  private detailInclude() {
    return {
      order: { select: { id: true, enquiryId: true } },
      builder: { select: { id: true, name: true, email: true, phone: true } },
      site: { select: { id: true, name: true, addressLine: true, city: true, state: true, pincode: true, gstin: true } },
      supplier: { select: { id: true, companyName: true, gstin: true, user: { select: { email: true, phone: true } } } },
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
      supplier: invoice.supplier
        ? {
            id: invoice.supplier.id,
            companyName: invoice.supplier.companyName,
            gstin: invoice.supplier.gstin,
            email: invoice.supplier.user?.email ?? null,
            phone: invoice.supplier.user?.phone ?? null,
          }
        : null,
      lineItems: (invoice.lineItems ?? []).map((li: any) => ({
        id: li.id,
        productId: li.productId,
        productName: li.productName,
        description: li.description,
        quantity: li.quantity,
        unitPrice: Number(li.unitPrice),
        taxRate: li.taxRate !== null && li.taxRate !== undefined ? Number(li.taxRate) : null,
        taxAmount: Number(li.taxAmount),
        subtotal: Number(li.subtotal),
        total: Number(li.total),
      })),
      subtotal: Number(invoice.subtotal),
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
