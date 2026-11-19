import { NextResponse } from "next/server";
import {
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  assertConsistentOrderSnapshot,
  resolveBuyerConfirmationState,
  resolveOrderFinalPayableAmount,
  BUYER_CONFIRMATION_STATE_LABELS,
  resolveInvoiceDisplayUnit,
} from "@matsrc/db";
import {
  prisma,
  formatCurrency,
  formatDate,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";
import { getSupplierDisplayName } from "@/lib/supplier-display";

export const dynamic = "force-dynamic";


export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: {
        id: true,
        enquiryId: true,
        orderNumber: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        totalAmount: true,
        taxAmount: true,
        finalPayableAmount: true,
        advancePercent: true,
        requiredAdvanceAmount: true,
        deliveryDate: true,
        quoteSelectionCompletedAt: true,
        isAggregated: true,
        aggregationPoolId: true,
        priceBeforeAggregation: true,
        priceAfterAggregation: true,
        siteId: true,
        site: { select: { id: true, name: true, state: true, gstin: true } },
        aggregationPool: {
          select: { status: true },
        },
        purchaseOrders: {
          select: { id: true, poNumber: true, status: true, version: true },
          orderBy: { version: "desc" },
        },
        // Invoice Generation & Management: read-only surface for the
        // Contractor/Client order page — only present once an Admin has
        // generated it (see apps/admin's Generate Invoice action /
        // apps/api's admin/orders/:orderId/invoice controller). Never
        // generated from this route. `totalAmount` here is the FINAL,
        // freight/other-charges/discount/rounding-inclusive figure frozen
        // by InvoicesService.generate() at invoice-generation time (see
        // apps/api/src/admin/invoices/invoices.service.ts) — deliberately
        // read here so the order page's displayed "Total" reflects any
        // freight/other charges an Admin confirmed on the Supplier Invoice
        // AFTER the order's own pre-invoice finalPayableAmount/totalAmount
        // snapshot was frozen. Order.finalPayableAmount/totalAmount
        // themselves are intentionally NEVER mutated by invoice generation
        // (see that service's own "Important implementation boundary" doc
        // comment) — they remain the authoritative figures for
        // payment/advance/outstanding calculations (order-outstanding.ts)
        // and are used below ONLY as the pre-invoice fallback.
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            totalAmount: true,
            subtotal: true,
            taxableValue: true,
            taxAmount: true,
            cgstAmount: true,
            sgstAmount: true,
            igstAmount: true,
            freightChargeAmount: true,
            otherChargesAmount: true,
            discountAmount: true,
            roundingAdjustment: true,
          },
        },
        // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
        // Dispatch — drives this route's `confirmationState`/`total` fields
        // below. See packages/db/lib/order-buyer-confirmation.ts for the
        // full rationale.
        supplierInvoice: {
          select: {
            status: true,
            confirmedTotalAmount: true,
            confirmedTaxableValue: true,
            confirmedTaxAmount: true,
            freightChargeAmount: true,
            otherChargesAmount: true,
            discountAmount: true,
            roundingAdjustment: true,
          },
        },
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            product: {
              select: {
                id: true,
                name: true,
                unit: true,
                supplier: { select: { id: true, companyName: true } },
              },
            },
          },
        },
        tracking: {
          select: {
            id: true,
            status: true,
            note: true,
            recordedAt: true,
          },
          orderBy: { recordedAt: "asc" },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // REQ-10: Bank Guarantee is only offered as a payment method choice if the
    // builder has an APPROVED/ACTIVE bank guarantee registered (REQ-09).
    const creditProfile = await prisma.creditProfile.findUnique({
      where: { userId: user.id },
      select: { bankGuaranteeEnabled: true, bankGuaranteeStatus: true },
    });
    const bankGuaranteeAvailable =
      Boolean(creditProfile?.bankGuaranteeEnabled) &&
      (creditProfile?.bankGuaranteeStatus === "APPROVED" || creditProfile?.bankGuaranteeStatus === "ACTIVE");

    // Product-Level GST / GST-Inclusive Buyer Payable (Phase 4): surface the
    // frozen, GST-inclusive finalPayableAmount (and its tax breakdown) once
    // this order has been confirmed through a snapshot-writing path; fall
    // back to the pre-existing GST-exclusive totalAmount for a
    // legacy/not-yet-confirmed order — never recomputed from current
    // GST/markup configuration. Same resolution rule as
    // apps/web/lib/order-outstanding.ts, so the payment page and this order
    // detail page always agree on "the order total".
    assertConsistentOrderSnapshot(order.id, {
      taxAmount: order.taxAmount == null ? null : Number(order.taxAmount),
      finalPayableAmount: order.finalPayableAmount == null ? null : Number(order.finalPayableAmount),
      advancePercent: order.advancePercent == null ? null : Number(order.advancePercent),
      requiredAdvanceAmount: order.requiredAdvanceAmount == null ? null : Number(order.requiredAdvanceAmount),
    });
    const hasGstSnapshot = order.finalPayableAmount != null;
    const preConfirmationEstimate = hasGstSnapshot ? Number(order.finalPayableAmount) : Number(order.totalAmount ?? 0);

    // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
    // Dispatch — the buyer-facing confirmation state (NEVER persisted —
    // recomputed on every read) and the authoritative final payable
    // amount, both derived from the SAME supplierInvoice snapshot read
    // above. See packages/db/lib/order-buyer-confirmation.ts for the full
    // rationale on why these can legitimately differ from the raw
    // Order.status / Order.finalPayableAmount this route also exposes
    // below for backward compatibility.
    const supplierInvoiceSnapshot = order.supplierInvoice
      ? {
          status: order.supplierInvoice.status,
          confirmedTotalAmount:
            order.supplierInvoice.confirmedTotalAmount != null ? Number(order.supplierInvoice.confirmedTotalAmount) : null,
        }
      : null;
    const confirmationState = resolveBuyerConfirmationState(order.status, supplierInvoiceSnapshot);
    const { amount: resolvedTotal, isFinalConfirmed } = resolveOrderFinalPayableAmount(
      preConfirmationEstimate,
      supplierInvoiceSnapshot
    );

    const isIntraState =
      !order.site?.state ||
      order.site.state.toLowerCase().includes("tamil") ||
      (order.site.gstin ? order.site.gstin.startsWith("33") : true);

    let itemsSubtotal = Number(order.totalAmount ?? 0);
    let freightChargeAmount = 0;
    let otherChargesAmount = 0;
    let discountAmount = 0;
    let roundingAdjustment = 0;
    let taxableValue = Number(order.totalAmount ?? 0);
    let taxAmount = order.taxAmount != null ? Number(order.taxAmount) : null;
    let cgstAmount: number | null =
      taxAmount != null && isIntraState ? Math.round((taxAmount / 2 + Number.EPSILON) * 100) / 100 : null;
    let sgstAmount: number | null =
      taxAmount != null && isIntraState && cgstAmount != null ? Math.round((taxAmount - cgstAmount + Number.EPSILON) * 100) / 100 : null;
    let igstAmount: number | null = taxAmount != null && !isIntraState ? taxAmount : null;
    let hasAdjustments = false;

    if (order.invoice) {
      itemsSubtotal = Number(order.invoice.subtotal);
      freightChargeAmount = Number(order.invoice.freightChargeAmount ?? 0);
      otherChargesAmount = Number(order.invoice.otherChargesAmount ?? 0);
      discountAmount = Number(order.invoice.discountAmount ?? 0);
      roundingAdjustment = Number(order.invoice.roundingAdjustment ?? 0);
      taxableValue = Number(order.invoice.taxableValue);
      taxAmount = Number(order.invoice.taxAmount);
      cgstAmount = Number(order.invoice.cgstAmount ?? 0);
      sgstAmount = Number(order.invoice.sgstAmount ?? 0);
      igstAmount = Number(order.invoice.igstAmount ?? 0);
      hasAdjustments = freightChargeAmount > 0 || otherChargesAmount > 0 || discountAmount > 0;
    } else if (order.supplierInvoice && order.supplierInvoice.status === "CONFIRMED") {
      freightChargeAmount = Number(order.supplierInvoice.freightChargeAmount ?? 0);
      otherChargesAmount = Number(order.supplierInvoice.otherChargesAmount ?? 0);
      discountAmount = Number(order.supplierInvoice.discountAmount ?? 0);
      roundingAdjustment = Number(order.supplierInvoice.roundingAdjustment ?? 0);
      taxableValue =
        order.supplierInvoice.confirmedTaxableValue != null
          ? Number(order.supplierInvoice.confirmedTaxableValue)
          : itemsSubtotal + freightChargeAmount + otherChargesAmount - discountAmount;
      taxAmount =
        order.supplierInvoice.confirmedTaxAmount != null
          ? Number(order.supplierInvoice.confirmedTaxAmount)
          : Number(order.taxAmount ?? 0);
      if (isIntraState) {
        cgstAmount = Math.round((taxAmount / 2 + Number.EPSILON) * 100) / 100;
        sgstAmount = Math.round((taxAmount - cgstAmount + Number.EPSILON) * 100) / 100;
        igstAmount = 0;
      } else {
        igstAmount = taxAmount;
        cgstAmount = 0;
        sgstAmount = 0;
      }
      hasAdjustments = freightChargeAmount > 0 || otherChargesAmount > 0 || discountAmount > 0;
    }

    const finalOrderTotal = order.invoice ? Number(order.invoice.totalAmount) : resolvedTotal;

    return NextResponse.json({
      id: order.id,
      enquiryId: order.enquiryId ?? order.id,
      orderNumber: order.orderNumber ?? null,
      status: order.status,
      // Admin-Confirmed Freight / Buyer Final Confirmation / Payment-Gated
      // Dispatch — the buyer-facing surface should always prefer these two
      // fields over the raw `status` above for display purposes; `status`
      // itself is left unchanged (still the real OrderStatus enum value)
      // for any existing caller that depends on its current semantics
      // (e.g. purchase-order generation gating, cancellation eligibility).
      confirmationState,
      confirmationStateLabel: BUYER_CONFIRMATION_STATE_LABELS[confirmationState],
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      // Payment link is available once the supplier has confirmed the order
      // (status is past PLACED and not CANCELLED) and payment is pending.
      paymentLinkAvailable:
        order.status !== OrderStatus.PLACED &&
        order.status !== OrderStatus.CANCELLED &&
        (order.paymentStatus === PaymentStatus.PENDING ||
          order.paymentStatus === PaymentStatus.PENDING_VERIFICATION),
      // Order reference number is always the LAST path segment — route moved
      // from /orders/[id]/payment -> /orders/payment/[id].
      paymentLink: `/orders/payment/${order.id}`,
      bankGuaranteeAvailable,

      supplierId: order.items[0]?.product.supplier.id ?? null,
      primaryListingId: order.items[0]?.product.id ?? null,
      total: finalOrderTotal,
      totalLabel: formatCurrency(finalOrderTotal),
      // GST breakdown & financial summary (including 18% GST on freight/other charges)
      gstInclusive: hasGstSnapshot || order.invoice != null,
      subtotalBeforeTax: taxableValue,
      itemsSubtotal,
      freightChargeAmount,
      otherChargesAmount,
      discountAmount,
      roundingAdjustment,
      taxableValue,
      hasAdjustments,
      taxAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      advancePercent: order.advancePercent == null ? null : Number(order.advancePercent),
      requiredAdvanceAmount: order.requiredAdvanceAmount == null ? null : Number(order.requiredAdvanceAmount),
      deliveryDate: formatDate(order.deliveryDate),
      supplierName: getSupplierDisplayName(
        order.items[0]?.product.supplier.companyName,
        order.items[0]?.product.supplier.id
      ),
      // PO trigger point: available once a supplier quote has been accepted for this enquiry.
      // Defensive guard: never true for a cancelled order, even if
      // quoteSelectionCompletedAt was set earlier (e.g. a supplier confirmed,
      // then all remaining candidates later declined some other line item).
      quoteAccepted: Boolean(order.quoteSelectionCompletedAt) && order.status !== OrderStatus.CANCELLED,

      isAggregated: order.isAggregated,
      aggregationPoolId: order.aggregationPoolId,
      poolLocked: order.aggregationPool?.status === "LOCKED" || order.aggregationPool?.status === "FULFILLING" || order.aggregationPool?.status === "CLOSED",
      priceBeforeAggregation: order.priceBeforeAggregation ? Number(order.priceBeforeAggregation) : null,
      priceAfterAggregation: order.priceAfterAggregation ? Number(order.priceAfterAggregation) : null,
      siteId: order.siteId,
      siteName: order.site?.name ?? "Unassigned",

      purchaseOrder: order.purchaseOrders[0]
        ? {
            id: order.purchaseOrders[0].id,
            poNumber: order.purchaseOrders[0].poNumber,
            status: order.purchaseOrders[0].status,
            version: order.purchaseOrders[0].version,
          }
        : null,
      invoice: order.invoice
        ? {
            id: order.invoice.id,
            invoiceNumber: order.invoice.invoiceNumber,
            // Final, freight/other-charges/discount/rounding-inclusive total
            // frozen by InvoicesService.generate() — see this route's own
            // `invoice` select comment above for why this is read instead
            // of (never in place of) `total`/`finalPayableAmount` above.
            totalAmount: Number(order.invoice.totalAmount),
          }
        : null,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        unit: resolveInvoiceDisplayUnit({ unit: item.product.unit, productName: item.product.name }),
        unitPrice: Number(item.unitPrice),
      })),
      tracking: order.tracking.map((step) => ({
        id: step.id,
        status: step.status,
        label: step.note || step.status,
        recordedAt: step.recordedAt,
      })),
    });
  } catch (error) {
    console.error("Order GET error:", error);
    return NextResponse.json({ error: "Failed to fetch order" }, { status: 500 });
  }
}

// PATCH /api/builder/orders/[id]
// REQ-10: Lets the builder choose Standard (BANK_TRANSFER) vs Bank Guarantee
// (CREDIT) as the payment method for this order, from the payment page.
// Bank Guarantee is only accepted if the builder's CreditProfile has an
// APPROVED/ACTIVE bank guarantee registered (REQ-09 gate), re-checked here
// server-side regardless of what the client sends.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));
    const { paymentMethod } = body as { paymentMethod?: string; siteId?: string | null };

    // Site-wise purchase reporting: allow retroactively tagging/re-tagging
    // this order to a builder-owned Site (or clearing it back to
    // "Unassigned" via null), independent of the paymentMethod flow below.
    // Handled first so a request can update only siteId without needing to
    // also resend a valid paymentMethod.
    if ("siteId" in body && paymentMethod === undefined) {
      const order = await prisma.order.findFirst({
        where: { id: params.id, userId: user.id },
        select: { id: true },
      });
      if (!order) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }

      let siteId: string | null = null;
      if (body.siteId !== null && body.siteId !== undefined && body.siteId !== "") {
        if (typeof body.siteId !== "string") {
          return NextResponse.json({ error: "siteId must be a string or null" }, { status: 400 });
        }
        const site = await prisma.site.findFirst({
          where: { id: body.siteId, builderId: user.id },
          select: { id: true },
        });
        if (!site) {
          return NextResponse.json({ error: "Site not found" }, { status: 404 });
        }
        siteId = site.id;
      }

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { siteId },
        select: { id: true, siteId: true, site: { select: { name: true } } },
      });

      return NextResponse.json({
        id: updated.id,
        siteId: updated.siteId,
        siteName: updated.site?.name ?? "Unassigned",
      });
    }

    if (paymentMethod !== "BANK_TRANSFER" && paymentMethod !== "CREDIT") {
      return NextResponse.json(
        { error: "paymentMethod must be BANK_TRANSFER or CREDIT" },
        { status: 400 }
      );
    }

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, paymentStatus: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      return NextResponse.json(
        { error: "Payment method cannot be changed after payment is completed" },
        { status: 400 }
      );
    }
    if (order.paymentStatus === PaymentStatus.PENDING_VERIFICATION) {
      return NextResponse.json(
        { error: "Payment method cannot be changed while a payment proof is awaiting admin verification" },
        { status: 400 }
      );
    }

    if (paymentMethod === "CREDIT") {
      const creditProfile = await prisma.creditProfile.findUnique({
        where: { userId: user.id },
        select: { bankGuaranteeEnabled: true, bankGuaranteeStatus: true },
      });
      const eligible =
        Boolean(creditProfile?.bankGuaranteeEnabled) &&
        (creditProfile?.bankGuaranteeStatus === "APPROVED" || creditProfile?.bankGuaranteeStatus === "ACTIVE");
      if (!eligible) {
        return NextResponse.json(
          { error: "Bank Guarantee is not approved for this account yet" },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { paymentMethod: paymentMethod as PaymentMethod },
      select: { id: true, paymentMethod: true },
    });

    return NextResponse.json({ id: updated.id, paymentMethod: updated.paymentMethod });
  } catch (error) {
    console.error("Order PATCH error:", error);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}

