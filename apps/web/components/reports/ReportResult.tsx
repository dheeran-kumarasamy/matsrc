import type {
  MaterialConsumptionRow,
  BestSupplierPricingRow,
  CostSavingsSummary,
} from "@/lib/reports-types";

type Props = {
  reportId: string;
  data: unknown;
};

// Renders the inline result table for each of the 3 real (available)
// reports, keyed by reportId. Kept as a single dispatcher component so
// ReportCard stays generic/reusable across all 7 report definitions.
export default function ReportResult({ reportId, data }: Props) {
  if (reportId === "material-consumption") {
    return <MaterialConsumptionResult rows={data as MaterialConsumptionRow[]} />;
  }
  if (reportId === "best-supplier-pricing") {
    return <BestSupplierPricingResult rows={data as BestSupplierPricingRow[]} />;
  }
  if (reportId === "potential-cost-savings") {
    return <CostSavingsResult summary={data as CostSavingsSummary} />;
  }
  return null;
}

function MaterialConsumptionResult({ rows }: { rows: MaterialConsumptionRow[] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-slate-400">No order history yet — place an order to see this report.</p>;
  }

  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Material</th>
            <th className="px-3 py-2 font-semibold">Qty ordered</th>
            <th className="px-3 py-2 font-semibold">Orders</th>
            <th className="px-3 py-2 font-semibold">Last ordered</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.productId} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-800">{row.name}</td>
              <td className="px-3 py-2 text-slate-700">
                {row.totalQuantity} {row.unit}
              </td>
              <td className="px-3 py-2 text-slate-700">{row.orderCount}</td>
              <td className="px-3 py-2 text-slate-500">
                {new Date(row.lastOrderedAt).toLocaleDateString("en-IN")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BestSupplierPricingResult({ rows }: { rows: BestSupplierPricingRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        No cross-supplier pricing available yet for materials you&apos;ve ordered.
      </p>
    );
  }

  return (
    <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-slate-100 p-3">
      {rows.map((row) => (
        <div key={row.canonicalKey}>
          <p className="text-xs font-semibold text-slate-800">
            {row.name} <span className="font-normal text-slate-400">({row.unit})</span>
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {row.options.map((option) => (
              <span
                key={option.supplierId}
                className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${
                  option.isCheapest
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                ₹{option.price.toLocaleString("en-IN")}
                {option.isCheapest ? " · Best" : ""}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CostSavingsResult({ summary }: { summary: CostSavingsSummary }) {
  if (summary.rows.length === 0) {
    return <p className="text-xs text-slate-400">No potential savings found right now — you&apos;re already getting the best price on your usual materials.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-800">
        Total potential savings: ₹{summary.totalPotentialSavings.toLocaleString("en-IN")}
      </p>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-100">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Material</th>
              <th className="px-3 py-2 font-semibold">Paid</th>
              <th className="px-3 py-2 font-semibold">Best available</th>
              <th className="px-3 py-2 font-semibold">Savings</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={row.productId} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-800">{row.name}</td>
                <td className="px-3 py-2 text-slate-700">₹{row.amountPaid.toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-slate-700">
                  ₹{(row.currentBestUnitPrice * row.quantityOrdered).toLocaleString("en-IN")}
                </td>
                <td className="px-3 py-2 font-semibold text-emerald-700">
                  ₹{row.potentialSavings.toLocaleString("en-IN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
