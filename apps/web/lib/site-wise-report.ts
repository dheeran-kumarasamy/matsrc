import { prisma, formatCurrency, formatDate } from "@/lib/builder-db";
import type {
  SiteWiseDetailRow,
  SiteWiseFilterOptions,
  SiteWiseReportFilters,
  SiteWiseSummary,
} from "@/lib/reports-types";

const DEFAULT_TAX_RATE_PERCENT = 18;

export type SiteWiseReportData = {
  summary: SiteWiseSummary;
  options: SiteWiseFilterOptions;
  allRows: SiteWiseDetailRow[];
};

// Shared data-fetching + aggregation logic for the site-wise purchase report,
// used by both the paginated JSON API route and the CSV/XLSX/PDF/Tally
// export routes so the numbers are always computed identically in one place.
// Money is always computed here, server-side, from OrderItem.quantity *
// OrderItem.unitPrice (+ taxRatePercent) — client input is never trusted.
export async function getSiteWiseReportData(
  builderId: string,
  filters: SiteWiseReportFilters
): Promise<SiteWiseReportData> {
  const where: any = { order: { userId: builderId } };

  if (filters.status) {
    where.order.status = filters.status;
  }

  if (filters.dateFrom || filters.dateTo) {
    where.order.createdAt = {};
    if (filters.dateFrom) where.order.createdAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      end.setHours(23, 59, 59, 999);
      where.order.createdAt.lte = end;
    }
  }

  if (filters.supplierId) {
    where.supplierId = filters.supplierId;
  }

  if (filters.siteId === "unassigned") {
    where.order.siteId = null;
  } else if (filters.siteId && filters.siteId !== "all") {
    where.order.siteId = filters.siteId;
  }

  if (filters.categoryId) {
    where.product = { categoryId: filters.categoryId };
  }

  const items = await prisma.orderItem.findMany({
    where,
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      taxRatePercent: true,
      supplierId: true,
      supplier: { select: { companyName: true } },
      product: {
        select: {
          name: true,
          unit: true,
          categoryId: true,
          category: { select: { id: true, name: true } },
        },
      },
      order: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          siteId: true,
          site: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { order: { createdAt: "desc" } },
  });

  const spendBySupplierMap = new Map<string, { supplierName: string; spend: number }>();
  const spendByCategoryMap = new Map<string, { categoryName: string; spend: number }>();
  const spendOverTimeMap = new Map<string, number>();
  const spendBySiteMap = new Map<string, { siteName: string; spend: number; orderIds: Set<string> }>();
  const orderIds = new Set<string>();

  const allRows: SiteWiseDetailRow[] = items.map((item) => {
    const unitPrice = Number(item.unitPrice);
    const taxRatePercent =
      item.taxRatePercent != null ? Number(item.taxRatePercent) : DEFAULT_TAX_RATE_PERCENT;
    const taxableValue = unitPrice * item.quantity;
    const gstAmount = (taxableValue * taxRatePercent) / 100;
    const total = taxableValue + gstAmount;

    orderIds.add(item.order.id);

    const supplierName = item.supplier.companyName;
    const supplierEntry = spendBySupplierMap.get(item.supplierId) ?? {
      supplierName,
      spend: 0,
    };
    supplierEntry.spend += total;
    spendBySupplierMap.set(item.supplierId, supplierEntry);

    const categoryId = item.product.categoryId;
    const categoryName = item.product.category?.name ?? "Uncategorized";
    const categoryEntry = spendByCategoryMap.get(categoryId) ?? { categoryName, spend: 0 };
    categoryEntry.spend += total;
    spendByCategoryMap.set(categoryId, categoryEntry);

    const monthKey = item.order.createdAt.toISOString().slice(0, 7); // YYYY-MM
    spendOverTimeMap.set(monthKey, (spendOverTimeMap.get(monthKey) ?? 0) + total);

    const siteKey = item.order.siteId ?? "__unassigned__";
    const siteName = item.order.site?.name ?? "Unassigned";
    const siteEntry = spendBySiteMap.get(siteKey) ?? {
      siteName,
      spend: 0,
      orderIds: new Set<string>(),
    };
    siteEntry.spend += total;
    siteEntry.orderIds.add(item.order.id);
    spendBySiteMap.set(siteKey, siteEntry);

    return {
      orderId: item.order.id,
      orderDate: item.order.createdAt.toISOString(),
      orderDateLabel: formatDate(item.order.createdAt) ?? "",
      status: item.order.status,
      supplierId: item.supplierId,
      supplierName,
      siteId: item.order.siteId,
      siteName,
      productName: item.product.name,
      quantity: item.quantity,
      unit: item.product.unit,
      unitPrice,
      taxableValue,
      taxRatePercent,
      gstAmount,
      total,
    };
  });

  const totalSpend = allRows.reduce((sum, row) => sum + row.total, 0);

  const summary: SiteWiseSummary = {
    totalSpend,
    orderCount: orderIds.size,
    itemCount: allRows.length,
    spendBySupplier: Array.from(spendBySupplierMap.entries())
      .map(([supplierId, v]) => ({ supplierId, supplierName: v.supplierName, spend: v.spend }))
      .sort((a, b) => b.spend - a.spend),
    spendByCategory: Array.from(spendByCategoryMap.entries())
      .map(([categoryId, v]) => ({ categoryId, categoryName: v.categoryName, spend: v.spend }))
      .sort((a, b) => b.spend - a.spend),
    spendOverTime: Array.from(spendOverTimeMap.entries())
      .map(([month, spend]) => ({ month, spend }))
      .sort((a, b) => (a.month < b.month ? -1 : 1)),
    spendBySite: Array.from(spendBySiteMap.entries())
      .map(([siteId, v]) => ({
        siteId: siteId === "__unassigned__" ? null : siteId,
        siteName: v.siteName,
        spend: v.spend,
        orderCount: v.orderIds.size,
      }))
      .sort((a, b) => b.spend - a.spend),
  };

  const [sites, suppliers, categories] = await Promise.all([
    prisma.site.findMany({
      where: { builderId },
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
    prisma.supplierProfile.findMany({
      where: { orderItems: { some: { order: { userId: builderId } } } },
      select: { id: true, companyName: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.category.findMany({
      where: { products: { some: { orderItems: { some: { order: { userId: builderId } } } } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const options: SiteWiseFilterOptions = {
    sites,
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.companyName })),
    categories,
  };

  return { summary, options, allRows };
}

export function paginateRows<T>(rows: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export { formatCurrency, formatDate };
