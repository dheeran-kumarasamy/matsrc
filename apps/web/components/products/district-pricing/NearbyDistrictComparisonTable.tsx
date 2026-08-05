"use client";

import { useMemo, useState } from "react";
import type { DistrictPricePanelNearbyRow } from "@/lib/district-pricing-types";
import { MethodBadge, ConfidenceBadge } from "./badges";

type SortKey = "districtName" | "medianPerBaseUnit" | "diffPct" | "priceDate";

// Sortable/filterable nearby-district comparison table with CSV export.
// CSV export is a client-side Blob download — no new dependency required.
export default function NearbyDistrictComparisonTable({
  rows,
  onView,
  onExport,
}: {
  rows: DistrictPricePanelNearbyRow[];
  onView?: () => void;
  onExport?: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("districtName");
  const [sortAsc, setSortAsc] = useState(true);
  const [confidenceFilter, setConfidenceFilter] = useState<"ALL" | "HIGH" | "MEDIUM" | "LOW">("ALL");

  const filtered = useMemo(() => {
    let result = rows;
    if (confidenceFilter !== "ALL") {
      result = result.filter((r) => r.confidence === confidenceFilter);
    }
    return [...result].sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [rows, sortKey, sortAsc, confidenceFilter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function handleExportCsv() {
    const header = ["District", "Median", "Min", "Max", "Confidence", "Method", "Last Updated", "Difference %"];
    const lines = filtered.map((r) =>
      [
        r.districtName,
        r.medianPerBaseUnit,
        r.minPerBaseUnit ?? "",
        r.maxPerBaseUnit ?? "",
        r.confidence,
        r.methodLabel,
        r.priceDate,
        r.diffPct !== null ? r.diffPct.toFixed(2) : "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "nearby-district-comparison.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onExport?.();
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-400">No nearby district data available for comparison yet.</p>
    );
  }

  return (
    <div onMouseEnter={onView}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Nearby district comparison</h3>
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter by confidence"
            value={confidenceFilter}
            onChange={(e) => setConfidenceFilter(e.target.value as typeof confidenceFilter)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
          >
            <option value="ALL">All confidence</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <button
            onClick={handleExportCsv}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Export CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
              <th className="cursor-pointer py-2" onClick={() => toggleSort("districtName")}>
                District
              </th>
              <th className="cursor-pointer py-2" onClick={() => toggleSort("medianPerBaseUnit")}>
                Median
              </th>
              <th className="py-2">Range</th>
              <th className="py-2">Confidence</th>
              <th className="py-2">Method</th>
              <th className="cursor-pointer py-2" onClick={() => toggleSort("priceDate")}>
                Last Updated
              </th>
              <th className="cursor-pointer py-2" onClick={() => toggleSort("diffPct")}>
                Difference %
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.districtCode} className="border-b border-slate-50">
                <td className="py-2 font-medium text-slate-700">{row.districtName}</td>
                <td className="py-2 text-slate-600">₹{row.medianPerBaseUnit.toLocaleString("en-IN")}</td>
                <td className="py-2 text-slate-500">
                  {row.minPerBaseUnit !== null && row.maxPerBaseUnit !== null
                    ? `₹${row.minPerBaseUnit.toLocaleString("en-IN")} - ₹${row.maxPerBaseUnit.toLocaleString("en-IN")}`
                    : "—"}
                </td>
                <td className="py-2">
                  <ConfidenceBadge confidence={row.confidence} />
                </td>
                <td className="py-2">
                  <MethodBadge label={row.methodLabel} />
                </td>
                <td className="py-2 text-slate-500">{row.priceDate}</td>
                <td className={`py-2 font-medium ${row.diffPct !== null && row.diffPct > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {row.diffPct !== null ? `${row.diffPct > 0 ? "+" : ""}${row.diffPct.toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
