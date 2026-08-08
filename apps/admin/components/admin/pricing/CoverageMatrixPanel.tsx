"use client";

import { useMemo, useState } from "react";
import type { PricingCoverageMatrix } from "@/lib/pricing-admin-types";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function stateColor(state: string) {
  switch (state) {
    case "OBSERVED":
      return "bg-emerald-500 text-white";
    case "DERIVED":
      return "bg-sky-400 text-white";
    case "MISSING":
      return "bg-red-400 text-white";
    default:
      return "bg-slate-100 text-slate-400";
  }
}

function trendArrow(trend: string | null) {
  if (trend === "UP") return "↑";
  if (trend === "DOWN") return "↓";
  if (trend === "FLAT") return "→";
  return "";
}

function toCsv(matrix: PricingCoverageMatrix) {
  const header = ["District", "Category", "State", "Observation Count", "Confidence", "Last Updated", "Trend"];
  const rows = matrix.cells.map((cell) => [
    cell.districtCode,
    cell.categoryCode,
    cell.state,
    String(cell.observationCount),
    cell.confidence ?? "",
    cell.lastUpdated ?? "",
    cell.trend ?? "",
  ]);
  return [header, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function CoverageMatrixPanel({ matrix }: { matrix: PricingCoverageMatrix | null }) {
  const [search, setSearch] = useState("");
  const [selectedCell, setSelectedCell] = useState<
    { districtCode: string; categoryCode: string; observationCount: number; confidence: string | null; lastUpdated: string | null; state: string } | null
  >(null);

  const filteredDistricts = useMemo(() => {
    if (!matrix) return [];
    if (!search.trim()) return matrix.districts;
    const q = search.trim().toLowerCase();
    return matrix.districts.filter((d) => d.code.toLowerCase().includes(q) || d.name.toLowerCase().includes(q));
  }, [matrix, search]);

  if (!matrix) {
    return (
      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Coverage Matrix</h3>
        <p className="mt-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
          Unable to load coverage matrix right now. Try refreshing the page.
        </p>
      </section>
    );
  }

  const cellByKey = new Map(matrix.cells.map((c) => [`${c.districtId}:${c.categoryId}`, c]));

  const handleExportCsv = () => {
    const csv = toCsv(matrix);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "coverage-matrix.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-slate-950">Coverage Matrix</h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by district…"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
          <button
            onClick={handleExportCsv}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        Legend: <span className="rounded bg-emerald-500 px-1 text-white">Observed</span>{" "}
        <span className="rounded bg-sky-400 px-1 text-white">Derived</span>{" "}
        <span className="rounded bg-red-400 px-1 text-white">Missing</span>{" "}
        <span className="rounded bg-slate-100 px-1 text-slate-400">No Data</span>. Click a cell for details.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left font-semibold text-slate-600">District</th>
              {matrix.categories.map((cat) => (
                <th key={cat.id} className="p-2 text-center font-semibold text-slate-600">
                  {cat.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredDistricts.map((district) => (
              <tr key={district.id}>
                <td className="sticky left-0 bg-white p-2 font-semibold text-slate-700">{district.code}</td>
                {matrix.categories.map((cat) => {
                  const cell = cellByKey.get(`${district.id}:${cat.id}`);
                  const state = cell?.state ?? "NO_DATA";
                  return (
                    <td key={cat.id} className="p-1 text-center">
                      <button
                        onClick={() =>
                          cell &&
                          setSelectedCell({
                            districtCode: district.code,
                            categoryCode: cat.code,
                            observationCount: cell.observationCount,
                            confidence: cell.confidence,
                            lastUpdated: cell.lastUpdated,
                            state: cell.state,
                          })
                        }
                        className={`h-8 w-full min-w-[2.5rem] rounded ${stateColor(state)} text-[10px] font-bold`}
                        title={`${district.code} / ${cat.code}: ${state}`}
                      >
                        {cell ? trendArrow(cell.trend) : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedCell ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex items-center justify-between">
            <p className="font-bold text-slate-800">
              {selectedCell.districtCode} / {selectedCell.categoryCode}
            </p>
            <button onClick={() => setSelectedCell(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
              Close
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <p>
              State: <span className="font-semibold">{selectedCell.state}</span>
            </p>
            <p>
              Observations: <span className="font-semibold">{selectedCell.observationCount}</span>
            </p>
            <p>
              Confidence: <span className="font-semibold">{selectedCell.confidence ?? "—"}</span>
            </p>
            <p>
              Last Updated: <span className="font-semibold">{formatDateTime(selectedCell.lastUpdated)}</span>
            </p>
          </div>
        </div>
      ) : null}

      <p className="mt-2 text-[11px] text-slate-400">
        PDF export not yet available for the coverage matrix — CSV export is supported. Cell click shows a detail summary; drilling into
        raw observations is planned for a future batch.
      </p>
    </section>
  );
}
