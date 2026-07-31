// Shared (client + server safe) TypeScript types for the Builder "Reports"
// feature. Contains no imports of Prisma/DB code so this file can be safely
// imported from client components (see components/reports/ReportsBody.tsx)
// as well as server-side report generation logic (lib/reports-data.ts).

export type ReportDataSource = "Account data" | "Live feed" | "Historical data" | "AI insight";

export type ReportDefinition = {
  id: string;
  title: string;
  description: string;
  dataSource: ReportDataSource;
  // Whether this report has a real backing data source today. Reports with
  // available: false render a disabled "Coming soon" state instead of
  // wiring a Generate action to a non-existent/empty data source.
  available: boolean;
};

export type MaterialConsumptionRow = {
  productId: string;
  name: string;
  unit: string;
  category: string;
  totalQuantity: number;
  orderCount: number;
  lastOrderedAt: string;
};

export type SupplierPriceOption = {
  supplierId: string;
  price: number;
  isCheapest: boolean;
};

export type BestSupplierPricingRow = {
  canonicalKey: string;
  name: string;
  unit: string;
  options: SupplierPriceOption[];
};

export type CostSavingsRow = {
  productId: string;
  name: string;
  unit: string;
  quantityOrdered: number;
  amountPaid: number;
  currentBestUnitPrice: number;
  potentialSavings: number;
};

export type CostSavingsSummary = {
  totalPotentialSavings: number;
  rows: CostSavingsRow[];
};

// ─────────────────────────────────────────────
// Site-wise Purchase Report (Feature A)
// ─────────────────────────────────────────────

export type SiteWiseReportFilters = {
  siteId?: string; // "all" | "unassigned" | <site id>
  dateFrom?: string; // ISO date (yyyy-mm-dd)
  dateTo?: string; // ISO date (yyyy-mm-dd)
  supplierId?: string;
  status?: string;
  categoryId?: string;
  page?: number;
  pageSize?: number;
};

export type SiteWiseSpendBySupplier = {
  supplierId: string;
  supplierName: string;
  spend: number;
};

export type SiteWiseSpendByCategory = {
  categoryId: string;
  categoryName: string;
  spend: number;
};

export type SiteWiseSpendOverTime = {
  month: string; // YYYY-MM
  spend: number;
};

export type SiteWiseSpendBySite = {
  siteId: string | null;
  siteName: string;
  spend: number;
  orderCount: number;
};

export type SiteWiseSummary = {
  totalSpend: number;
  orderCount: number;
  itemCount: number;
  spendBySupplier: SiteWiseSpendBySupplier[];
  spendByCategory: SiteWiseSpendByCategory[];
  spendOverTime: SiteWiseSpendOverTime[];
  spendBySite: SiteWiseSpendBySite[];
};

export type SiteWiseDetailRow = {
  orderId: string;
  orderDate: string;
  orderDateLabel: string;
  status: string;
  supplierId: string;
  supplierName: string;
  siteId: string | null;
  siteName: string;
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxableValue: number;
  taxRatePercent: number;
  gstAmount: number;
  total: number;
};

export type SiteWiseFilterOptions = {
  sites: { id: string; name: string; status: "ACTIVE" | "ARCHIVED" }[];
  suppliers: { id: string; name: string }[];
  categories: { id: string; name: string }[];
};

export type SiteWiseReportResponse = {
  filters: SiteWiseReportFilters;
  summary: SiteWiseSummary;
  options: SiteWiseFilterOptions;
  detail: {
    rows: SiteWiseDetailRow[];
    page: number;
    pageSize: number;
    totalRows: number;
  };
};

