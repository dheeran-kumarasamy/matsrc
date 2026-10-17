import { prisma } from "@/lib/builder-db";
import { calculateLineGst, roundCurrency, DEFAULT_TAX_RATE_PERCENT } from "@matsrc/db";
import type { TallyValidationBlocker, TallyVoucherInput, TallyVoucherLineItem } from "@/lib/tally-xml";

// Buyer Invoice / Frozen Order Snapshot Reconciliation (Phase 5B) reused
// here for the SAME reason: comparing two already-independently-rounded
// currency figures (the Tally voucher's own line-item-derived total vs.
// the confirmed SupplierInvoice's stored confirmedTotalAmount aggregate).
// Mirrors apps/api/src/admin/invoices/invoices.service.ts's identical
// RECONCILIATION_TOLERANCE exactly — one cent, matching Decimal(12,2).
const RECONCILIATION_TOLERANCE = 0.01;

export type TallyExportFilters = {
  siteId?: string; // "all" | "unassigned" | <site id>
  dateFrom?: string;
  dateTo?: string;
  status?: string; // defaults to PAID-only per approved default
};

export type TallyVoucherBuildResult = {
  vouchers: TallyVoucherInput[];
  // Orders excluded from the export outright (confirmed-but-unallocatable
  // multi-supplier orders, or confirmed supplier-invoice data that is
  // missing/inconsistent) — never silently downgraded to an estimate.
  blockers: TallyValidationBlocker[];
};

type OrderItemRow = {
  id: string;
  quantity: number;
  unitPrice: unknown;
  supplierUnitPrice: unknown;
  taxRatePercent: unknown;
  supplierId: string;
  supplier: { companyName: string; gstin: string | null };
  product: { name: string; unit: string; hsnCode: string | null };
};

function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

// Tally Purchase Voucher Supplier-Cost Fix — Unconfirmed/Absent path.
// Mirrors apps/web/lib/purchase-order-utils.ts's buildPurchaseOrderLineItemData
// EXACTLY: OrderItem.supplierUnitPrice is the source of supplier cost,
// falling back to OrderItem.unitPrice only for legacy rows with no
// recorded supplier price. Never derives historical supplier cost from
// current markup configuration.
function buildEstimateLineItem(item: OrderItemRow): TallyVoucherLineItem {
  const supplierUnitPrice =
    item.supplierUnitPrice !== null && item.supplierUnitPrice !== undefined
      ? toNumber(item.supplierUnitPrice)
      : toNumber(item.unitPrice);

  const gst = calculateLineGst({
    quantity: item.quantity,
    unitPrice: supplierUnitPrice,
    gstRatePercent:
      item.taxRatePercent !== null && item.taxRatePercent !== undefined ? toNumber(item.taxRatePercent) : null,
  });

  return {
    productName: item.product.name,
    hsnCode: item.product.hsnCode,
    quantity: item.quantity,
    unit: item.product.unit,
    unitPrice: gst.unitPrice,
    taxableValue: gst.lineSubtotal,
    taxRatePercent: gst.gstRatePercent,
    gstAmount: gst.gstAmount,
  };
}

// Builds one voucher PER SUPPLIER for an unconfirmed/absent-invoice order.
// Splitting by OrderItem.supplierId is always mechanically reliable here —
// every OrderItem always carries exactly one supplierId, and there is no
// invoice-level aggregate (freight/discount/rounding) to allocate across
// suppliers at this stage, unlike the confirmed path below.
function buildEstimateVouchers(order: {
  id: string;
  createdAt: Date;
  site: { state: string | null; gstin: string | null } | null;
  items: OrderItemRow[];
}): TallyVoucherInput[] {
  const groups = new Map<string, OrderItemRow[]>();
  for (const item of order.items) {
    const group = groups.get(item.supplierId) ?? [];
    group.push(item);
    groups.set(item.supplierId, group);
  }

  const vouchers: TallyVoucherInput[] = [];
  for (const [supplierId, items] of groups) {
    const lineItems = items.map(buildEstimateLineItem);
    const total = roundCurrency(lineItems.reduce((sum, li) => sum + li.taxableValue + li.gstAmount, 0));

    vouchers.push({
      orderId: order.id,
      orderDate: order.createdAt,
      supplierId,
      supplierName: items[0].supplier.companyName,
      supplierGstin: items[0].supplier.gstin,
      siteState: order.site?.state ?? null,
      siteGstin: order.site?.gstin ?? null,
      lineItems,
      total,
      isEstimate: true,
    });
  }
  return vouchers;
}

// Builds the list of Tally Purchase Voucher inputs (one per order, or one
// per supplier for an estimate order whose items span multiple suppliers)
// for a builder, applying the same filter semantics as the site-wise
// report. Defaults to PAID orders only (per approved design decision)
// unless an explicit status filter is supplied.
//
// Tally Purchase Voucher Supplier-Cost Fix: this is the SOLE place
// supplier-cost sourcing for the Tally export is decided. Per order:
//   - CONFIRMED SupplierInvoice -> use the admin-confirmed
//     SupplierInvoiceLineItem/SupplierInvoice figures (never the buyer's
//     marked-up OrderItem.unitPrice, never recomputed from current
//     config). A confirmed order whose items span multiple suppliers, or
//     whose confirmed data is missing/inconsistent/cannot be reconciled,
//     is EXCLUDED with an explicit blocker — never silently downgraded to
//     an estimate.
//   - Absent or not-yet-CONFIRMED SupplierInvoice -> estimate, built from
//     OrderItem.supplierUnitPrice (legacy fallback to unitPrice), split
//     per supplier when the order's items span more than one supplier.
export async function buildVouchersForBuilder(
  builderId: string,
  filters: TallyExportFilters
): Promise<TallyVoucherBuildResult> {
  const where: any = { userId: builderId };

  if (filters.status) {
    where.status = filters.status;
  } else {
    where.paymentStatus = "PAID";
  }

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  if (filters.siteId === "unassigned") {
    where.siteId = null;
  } else if (filters.siteId && filters.siteId !== "all") {
    where.siteId = filters.siteId;
  }

  const orders = await prisma.order.findMany({
    where,
    select: {
      id: true,
      createdAt: true,
      totalAmount: true,
      site: { select: { id: true, state: true, gstin: true } },
      items: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          supplierUnitPrice: true,
          taxRatePercent: true,
          supplierId: true,
          supplier: { select: { companyName: true, gstin: true } },
          product: { select: { name: true, unit: true, hsnCode: true } },
        },
      },
      supplierInvoice: {
        select: {
          status: true,
          freightChargeAmount: true,
          otherChargesAmount: true,
          discountAmount: true,
          roundingAdjustment: true,
          confirmedTotalAmount: true,
          lineItems: {
            select: {
              orderItemId: true,
              approvedUnitPrice: true,
              actualQuantity: true,
              taxRatePercent: true,
              lineSubtotal: true,
              lineTaxAmount: true,
              lineTotal: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const vouchers: TallyVoucherInput[] = [];
  const blockers: TallyValidationBlocker[] = [];

  for (const order of orders) {
    if (order.items.length === 0) continue;

    const supplierInvoice = (order as any).supplierInvoice;

    if (supplierInvoice && supplierInvoice.status === "CONFIRMED") {
      const result = buildConfirmedVoucher(order as any, supplierInvoice);
      if ("blocker" in result) {
        blockers.push(result.blocker);
      } else {
        vouchers.push(result.voucher);
      }
      continue;
    }

    // Absent, PENDING_REVIEW, or REJECTED SupplierInvoice — all treated
    // identically as "no confirmed supplier cost available yet": build an
    // explicit estimate from the agreed OrderItem.supplierUnitPrice.
    vouchers.push(...buildEstimateVouchers(order as any));
  }

  return { vouchers, blockers };
}

// Tally Purchase Voucher Supplier-Cost Fix — Confirmed path. Returns either
// a single voucher (single-supplier order, fully reconciled confirmed
// data) or an explicit blocker (multi-supplier order that cannot be
// reliably allocated, or confirmed data that is missing/inconsistent/does
// not reconcile) — NEVER a silent fallback to the estimate path for a
// nominally-confirmed-but-corrupt record.
function buildConfirmedVoucher(
  order: {
    id: string;
    createdAt: Date;
    site: { state: string | null; gstin: string | null } | null;
    items: OrderItemRow[];
  },
  supplierInvoice: {
    freightChargeAmount: unknown;
    otherChargesAmount: unknown;
    discountAmount: unknown;
    roundingAdjustment: unknown;
    confirmedTotalAmount: unknown;
    lineItems: Array<{
      orderItemId: string;
      approvedUnitPrice: unknown;
      actualQuantity: unknown;
      taxRatePercent: unknown;
      lineSubtotal: unknown;
      lineTaxAmount: unknown;
      lineTotal: unknown;
    }>;
  }
): { voucher: TallyVoucherInput } | { blocker: TallyValidationBlocker } {
  // Multi-supplier orders: every OrderItem.supplierId is already known, but
  // unlike the estimate path, a CONFIRMED SupplierInvoice carries
  // invoice-level freight/other-charges/discount/rounding that have no
  // existing, reliable per-supplier allocation formula anywhere in this
  // codebase (SupplierInvoicesService treats the whole invoice as a single
  // document tied to one SupplierInvoice.supplierId). Reject rather than
  // invent an allocation — mirrors InvoicesService.generate()'s and
  // PurchaseOrdersService.create()'s identical multi-supplier rejection.
  const supplierIds = new Set(order.items.map((item) => item.supplierId));
  if (supplierIds.size > 1) {
    return {
      blocker: {
        orderId: order.id,
        reason:
          "This order spans multiple suppliers and its confirmed supplier invoice cannot be reliably split into per-supplier Tally vouchers.",
      },
    };
  }

  const itemById = new Map(order.items.map((item) => [item.id, item]));

  // Defense-in-depth: SupplierInvoicesService.confirm() already requires
  // lineItems.length === order.items.length before allowing CONFIRMED, but
  // this module never trusts that invariant blindly — any mismatch fails
  // closed rather than silently proceeding with partial/corrupt data.
  if (supplierInvoice.lineItems.length !== order.items.length) {
    return {
      blocker: {
        orderId: order.id,
        reason: "The confirmed supplier invoice for this order does not cover every order line item.",
      },
    };
  }


  const lineItems: TallyVoucherLineItem[] = [];
  for (const sli of supplierInvoice.lineItems) {
    const item = itemById.get(sli.orderItemId);
    if (!item) {
      return {
        blocker: {
          orderId: order.id,
          reason: "The confirmed supplier invoice references a line item that no longer matches this order.",
        },
      };
    }
    lineItems.push({
      productName: item.product.name,
      hsnCode: item.product.hsnCode,
      quantity: toNumber(sli.actualQuantity),
      unit: item.product.unit,
      unitPrice: toNumber(sli.approvedUnitPrice),
      taxableValue: toNumber(sli.lineSubtotal),
      taxRatePercent:
        sli.taxRatePercent !== null && sli.taxRatePercent !== undefined
          ? toNumber(sli.taxRatePercent)
          : DEFAULT_TAX_RATE_PERCENT,
      gstAmount: toNumber(sli.lineTaxAmount),
    });
  }

  // Invoice-level freight/other-charges/discount — the current Tally
  // ledger mapping (TallyLedgerMappingConfig) has no dedicated, explicitly
  // mapped ledger for these adjustment types. Rather than inventing an
  // allocation into the purchase/round-off ledger (which would disguise a
  // genuine, material accounting adjustment as something it is not), this
  // voucher is blocked until a dedicated ledger mapping exists.
  const freightChargeAmount = toNumber(supplierInvoice.freightChargeAmount);
  const otherChargesAmount = toNumber(supplierInvoice.otherChargesAmount);
  const discountAmount = toNumber(supplierInvoice.discountAmount);
  if (
    Math.abs(freightChargeAmount) >= 0.005 ||
    Math.abs(otherChargesAmount) >= 0.005 ||
    Math.abs(discountAmount) >= 0.005
  ) {
    return {
      blocker: {
        orderId: order.id,
        reason:
          "The confirmed supplier invoice includes freight/other charges/discount amounts that have no mapped Tally ledger; this order cannot be exported until a dedicated ledger mapping is configured.",
      },
    };
  }

  // roundingAdjustment is the one invoice-level figure whose persisted
  // semantics (see SupplierInvoice schema doc comment) already match the
  // existing Tally roundOffLedger's intended use — never a disguised
  // discount/charge. Passed through to tally-xml.ts's own round-off
  // computation rather than folded into any line's taxable value.
  const roundingAdjustment = toNumber(supplierInvoice.roundingAdjustment);

  const totalTaxable = roundCurrency(lineItems.reduce((sum, li) => sum + li.taxableValue, 0));
  const totalTax = roundCurrency(lineItems.reduce((sum, li) => sum + li.gstAmount, 0));
  const totalAmount = roundCurrency(totalTaxable + totalTax + roundingAdjustment);

  // Fail-closed reconciliation: the voucher's own line-item-derived total
  // must match the persisted confirmedTotalAmount aggregate within
  // tolerance. A mismatch means the confirmed data is internally
  // inconsistent — never silently exported with a divergent figure.
  if (
    supplierInvoice.confirmedTotalAmount === null ||
    supplierInvoice.confirmedTotalAmount === undefined ||
    Math.abs(totalAmount - toNumber(supplierInvoice.confirmedTotalAmount)) > RECONCILIATION_TOLERANCE
  ) {
    return {
      blocker: {
        orderId: order.id,
        reason: "The confirmed supplier invoice's line items do not reconcile with its confirmed total amount.",
      },
    };
  }

  const primaryItem = order.items[0];

  return {
    voucher: {
      orderId: order.id,
      orderDate: order.createdAt,
      supplierId: primaryItem.supplierId,
      supplierName: primaryItem.supplier.companyName,
      supplierGstin: primaryItem.supplier.gstin,
      siteState: order.site?.state ?? null,
      siteGstin: order.site?.gstin ?? null,
      lineItems,
      total: totalAmount,
      isEstimate: false,
      roundingAdjustment,
    },
  };
}

