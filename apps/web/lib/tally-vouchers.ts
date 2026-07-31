import { prisma } from "@/lib/builder-db";
import type { TallyVoucherInput } from "@/lib/tally-xml";

const DEFAULT_TAX_RATE_PERCENT = 18;

export type TallyExportFilters = {
  siteId?: string; // "all" | "unassigned" | <site id>
  dateFrom?: string;
  dateTo?: string;
  status?: string; // defaults to PAID-only per approved default
};

// Builds the list of Tally Purchase Voucher inputs (one per order) for a
// builder, applying the same filter semantics as the site-wise report.
// Defaults to PAID orders only (per approved design decision) unless an
// explicit status filter is supplied.
export async function buildVouchersForBuilder(
  builderId: string,
  filters: TallyExportFilters
): Promise<TallyVoucherInput[]> {
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
          quantity: true,
          unitPrice: true,
          taxRatePercent: true,
          supplierId: true,
          supplier: { select: { companyName: true, gstin: true } },
          product: { select: { name: true, unit: true, hsnCode: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const vouchers: TallyVoucherInput[] = [];

  for (const order of orders) {
    if (order.items.length === 0) continue;

    // One voucher per order; if an order somehow has line items across
    // multiple suppliers (shouldn't normally happen, orders are grouped
    // per-supplier at checkout), attribute the voucher to the first
    // item's supplier as a conservative default.
    const primarySupplier = order.items[0].supplier;
    const primarySupplierId = order.items[0].supplierId;

    const lineItems = order.items.map((item) => {
      const unitPrice = Number(item.unitPrice);
      const taxRatePercent =
        item.taxRatePercent != null ? Number(item.taxRatePercent) : DEFAULT_TAX_RATE_PERCENT;
      const taxableValue = unitPrice * item.quantity;
      const gstAmount = (taxableValue * taxRatePercent) / 100;
      return {
        productName: item.product.name,
        hsnCode: item.product.hsnCode,
        quantity: item.quantity,
        unit: item.product.unit,
        unitPrice,
        taxableValue,
        taxRatePercent,
        gstAmount,
      };
    });

    const total = lineItems.reduce((sum, li) => sum + li.taxableValue + li.gstAmount, 0);

    vouchers.push({
      orderId: order.id,
      orderDate: order.createdAt,
      supplierId: primarySupplierId,
      supplierName: primarySupplier.companyName,
      supplierGstin: primarySupplier.gstin,
      siteState: order.site?.state ?? null,
      siteGstin: order.site?.gstin ?? null,
      lineItems,
      total,
    });
  }

  return vouchers;
}
