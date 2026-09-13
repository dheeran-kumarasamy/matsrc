"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PricingScrapedPricesResponse } from "@/lib/pricing-admin-types";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(value)
  );
}

function inr(value: number | null) {
  if (value === null) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function confidenceBadgeClasses(confidence: string) {
  switch (confidence) {
    case "HIGH":
      return "bg-emerald-50 text-emerald-700";
    case "MEDIUM":
      return "bg-amber-50 text-amber-700";
    case "LOW":
      return "bg-red-50 text-red-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function toCsv(rows: PricingScrapedPricesResponse["rows"]) {
  const header = [
    "Price Date",
    "SKU Code",
    "Category",
    "Brand",
    "Grade",
    "Size",
    "Geography",
    "District/State",
    "Median Price",
    "Min",
    "Max",
    "Base Unit",
    "Observations",
    "Sources",
    "Method",
    "Confidence",
    "Public Display Allowed",
  ];
  const csvRows = rows.map((r) => [
    r.priceDate,
    r.canonicalSku.code,
    r.canonicalSku.materialCategory?.name ?? "",
    r.canonicalSku.brandName ?? "",
    r.canonicalSku.grade ?? "",
    r.canonicalSku.sizeLabel ?? "",
    r.geographyLevel,
    r.district?.name ?? r.state?.name ?? "National",
    String(r.medianPerBaseUnit),
    r.minPerBaseUnit !== null ? String(r.minPerBaseUnit) : "",
    r.maxPerBaseUnit !== null ? String(r.maxPerBaseUnit) : "",
    r.baseUnit,
    String(r.observationCount),
    String(r.sourceCount),
    r.method,
    r.confidence,
    String(r.publicDisplayAllowed),
  ]);
  return [header, ...csvRows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

type Props = {
  initial: PricingScrapedPricesResponse;
  searchParams: { search?: string; districtId?: string; fromDate?: string; toDate?: string; page?: string };
};

export function ScrapedPricesTable({ initial, searchParams }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState(searchParams.search ?? "");
  const [fromDate, setFromDate] = useState(searchParams.fromDate ?? "");
  const [toDate, setToDate] = useState(searchParams.toDate ?? "");

  const { rows, total, page, pageSize } = initial;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  function applyFilters(nextPage?: number) {
    const qs = new URLSearchParams();
    if (search.trim()) qs.set("search", search.trim());
    if (fromDate) qs.set("fromDate", fromDate);
    if (toDate) qs.set("toDate", toDate);
    if (nextPage && nextPage > 1) qs.set("page", String(nextPage));
    router.push(`/pricing/scraped-prices${qs.toString() ? `?${qs.toString()}` : ""}`);
  }

  function clearFilters() {
    setSearch("");
    setFromDate("");
    setToDate("");
    router.push("/pricing/scraped-prices");
  }

  const handleExportCsv = () => {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "scraped-prices.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel p-4" aria-label="Scraped Prices">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-slate-600">Search (SKU code / grade / brand)</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            placeholder="e.g. TMT_FE500 or SAIL"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600">From date</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600">To date</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
        <button
          type="button"
          onClick={() => applyFilters()}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
        >
          Apply Filters
        </button>
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleExportCsv}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
        >
          Export CSV (this page)
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {total} row{total === 1 ? "" : "s"} total · page {page} of {totalPages}
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="p-2">Date</th>
              <th className="p-2">Product (SKU)</th>
              <th className="p-2">Brand / Grade / Size</th>
              <th className="p-2">Geography</th>
              <th className="p-2">Median Price</th>
              <th className="p-2">Range (Min–Max)</th>
              <th className="p-2">Observations</th>
              <th className="p-2">Sources</th>
              <th className="p-2">Method</th>
              <th className="p-2">Confidence</th>
              <th className="p-2">Public</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="p-4 text-center text-slate-500">
                  No scraped price rows match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 align-top">
                  <td className="p-2 whitespace-nowrap">{formatDate(row.priceDate)}</td>
                  <td className="p-2">
                    <p className="font-semibold text-slate-800">{row.canonicalSku.code}</p>
                    <p className="text-slate-500">{row.canonicalSku.materialCategory?.name ?? "—"}</p>
                  </td>
                  <td className="p-2 text-slate-600">
                    {[row.canonicalSku.brandName, row.canonicalSku.grade, row.canonicalSku.sizeLabel]
                      .filter(Boolean)
                      .join(" / ") || "—"}
                  </td>
                  <td className="p-2">
                    <p className="font-semibold text-slate-700">{row.geographyLevel}</p>
                    <p className="text-slate-500">{row.district?.name ?? row.state?.name ?? "National"}</p>
                  </td>
                  <td className="p-2 font-semibold text-slate-900">
                    {inr(row.medianPerBaseUnit)}
                    <span className="ml-1 font-normal text-slate-400">/{row.baseUnit}</span>
                  </td>
                  <td className="p-2 text-slate-600">
                    {row.minPerBaseUnit !== null && row.maxPerBaseUnit !== null
                      ? `${inr(row.minPerBaseUnit)} – ${inr(row.maxPerBaseUnit)}`
                      : "—"}
                  </td>
                  <td className="p-2">{row.observationCount}</td>
                  <td className="p-2">
                    {row.sourceCount}
                    {row.contributingSourceCodes.length > 0 && (
                      <p className="text-[10px] text-slate-400">{row.contributingSourceCodes.join(", ")}</p>
                    )}
                  </td>
                  <td className="p-2">{row.method}</td>
                  <td className="p-2">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${confidenceBadgeClasses(row.confidence)}`}>
                      {row.confidence}
                    </span>
                  </td>
                  <td className="p-2">
                    {row.publicDisplayAllowed ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Yes</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">No</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => applyFilters(page - 1)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Previous
        </button>
        <span className="text-xs text-slate-500">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => applyFilters(page + 1)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </section>
  );
}
