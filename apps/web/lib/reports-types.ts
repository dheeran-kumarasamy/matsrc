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
