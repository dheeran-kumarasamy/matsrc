"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { builderApiGet } from "@/lib/api";
import type { SiteWiseReportResponse } from "@/lib/reports-types";

const STATUS_OPTIONS = ["PLACED", "PROCESSING", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

function formatCurrency(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function SiteWiseReportPage() {
  const [data, setData] = useState<SiteWiseReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [siteId, setSiteId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set("siteId", siteId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (supplierId) params.set("supplierId", supplierId);
    if (status) params.set("status", status);
    if (categoryId) params.set("categoryId", categoryId);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return params.toString();
  }, [siteId, dateFrom, dateTo, supplierId, status, categoryId, page]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await builderApiGet<SiteWiseReportResponse>(`/reports/site-wise?${buildQuery()}`);
      setData(result);
    } catch (err) {
      setError("Failed to load report. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleFilterChange() {
    setPage(1);
  }

  function exportUrl(format: string) {
    const params = new URLSearchParams();
    params.set("siteId", siteId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (supplierId) params.set("supplierId", supplierId);
    if (status) params.set("status", status);
    if (categoryId) params.set("categoryId", categoryId);
    params.set("format", format);
    return `/api/builder/reports/site-wise/export?${params.toString()}`;
  }

  const summary = data?.summary;
  const options = data?.options;
  const detail = data?.detail;
  const totalPages = detail ? Math.max(1, Math.ceil(detail.totalRows / detail.pageSize)) : 1;

  return (
    <div className="report-body mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <Link
            href="/reports"
            className="text-[10px] font-bold uppercase tracking-[0.25em] text-[color:var(--posh-primary)] hover:underline"
          >
            ← Back to Reports
          </Link>
          <h1 className="report-display mt-2 text-4xl text-slate-900 md:text-5xl">
            Site-wise Purchase Report
          </h1>
          <p className="mt-2 text-sm font-medium text-slate-600">
            Everything you've purchased through Buildohub, broken down by construction site.
          </p>
        </div>
        <span className="report-eyebrow hidden md:inline">Procurement desk</span>
      </div>

      {/* Filter bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-5 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className="report-label mb-1.5 block">Site</label>
          <select
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              handleFilterChange();
            }}
            className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
          >
            <option value="all">All sites</option>
            <option value="unassigned">Unassigned</option>
            {options?.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.status === "ARCHIVED" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="report-label mb-1.5 block">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              handleFilterChange();
            }}
            className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
          />
        </div>
        <div>
          <label className="report-label mb-1.5 block">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              handleFilterChange();
            }}
            className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
          />
        </div>
        <div>
          <label className="report-label mb-1.5 block">Supplier</label>
          <select
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              handleFilterChange();
            }}
            className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
          >
            <option value="">All suppliers</option>
            {options?.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="report-label mb-1.5 block">Status</label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              handleFilterChange();
            }}
            className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="report-label mb-1.5 block">Category</label>
          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              handleFilterChange();
            }}
            className="w-full rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"
          >
            <option value="">All categories</option>
            {options?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Export buttons */}
      <div className="mb-6 flex flex-wrap gap-2">
        <a
          href={exportUrl("csv")}
          className="rounded-full border border-slate-200 bg-[color:var(--posh-bg-card)] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          Export CSV
        </a>
        <a
          href={exportUrl("xlsx")}
          className="rounded-full border border-slate-200 bg-[color:var(--posh-bg-card)] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          Export XLSX
        </a>
        <a
          href={exportUrl("pdf")}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-slate-200 bg-[color:var(--posh-bg-card)] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          Export PDF
        </a>
        <Link
          href="/reports/site-wise/tally"
          className="rounded-full border border-[color:var(--posh-border)] bg-[rgba(var(--posh-wash-rgb),0.04)] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--posh-primary)] transition-colors hover:bg-[rgba(var(--posh-wash-rgb),0.08)]"
        >
          Export to Tally
        </Link>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-10 text-center text-sm font-semibold text-slate-500 shadow-sm">
          Loading report…
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-10 text-center text-sm font-semibold text-red-600">
          {error}
        </div>
      ) : !summary || summary.itemCount === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-10 text-center text-sm font-semibold text-slate-500 shadow-sm">
          No purchases found for the selected filters.
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-6 shadow-sm">
              <div className="report-eyebrow">Total Spend</div>
              <div className="report-display mt-3 text-3xl text-slate-900">
                {formatCurrency(summary.totalSpend)}
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-6 shadow-sm">
              <div className="report-eyebrow">Orders</div>
              <div className="report-display mt-3 text-3xl text-slate-900">{summary.orderCount}</div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-6 shadow-sm">
              <div className="report-eyebrow">Line Items</div>
              <div className="report-display mt-3 text-3xl text-slate-900">{summary.itemCount}</div>
            </div>
          </div>

          {/* Per-site subtotals, only meaningful for "all sites" view */}
          {siteId === "all" && summary.spendBySite.length > 0 ? (
            <div className="mb-6 rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-6 shadow-sm">
              <h2 className="report-display mb-4 text-xl text-slate-900">Spend by Site</h2>
              <div className="space-y-2.5">
                {summary.spendBySite.map((s) => (
                  <div
                    key={s.siteId ?? "unassigned"}
                    className="flex items-center justify-between border-b border-slate-100 pb-2.5 text-sm last:border-0 last:pb-0"
                  >
                    <span className="font-semibold text-slate-800">
                      {s.siteName}{" "}
                      <span className="text-xs font-medium text-slate-400">({s.orderCount} orders)</span>
                    </span>
                    <span className="report-display text-lg text-slate-900">{formatCurrency(s.spend)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Charts */}
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-6 shadow-sm">
              <h2 className="report-display mb-4 text-xl text-slate-900">Spend by Supplier</h2>
              <ResponsiveContainer width="100%" height={240}>
                {/* Monochrome chart palette — bars, lines, axes and ticks are
                    all black to match the site-wide black & white design. */}
                <BarChart data={summary.spendBySupplier.slice(0, 8)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--posh-border)" />
                  <XAxis
                    dataKey="supplierName"
                    tick={{ fontSize: 10, fill: "var(--posh-fg-muted)" }}
                    stroke="var(--posh-primary)"
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "var(--posh-fg-muted)" }} stroke="var(--posh-primary)" />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    labelStyle={{ color: "var(--posh-fg-muted)" }}
                    itemStyle={{ color: "var(--posh-fg-muted)" }}
                  />
                  <Bar dataKey="spend" fill="var(--posh-primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-6 shadow-sm">
              <h2 className="report-display mb-4 text-xl text-slate-900">Spend Over Time</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={summary.spendOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--posh-border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--posh-fg-muted)" }} stroke="var(--posh-primary)" />
                  <YAxis tick={{ fontSize: 10, fill: "var(--posh-fg-muted)" }} stroke="var(--posh-primary)" />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    labelStyle={{ color: "var(--posh-fg-muted)" }}
                    itemStyle={{ color: "var(--posh-fg-muted)" }}
                  />
                  <Line type="monotone" dataKey="spend" stroke="var(--posh-primary)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Detail table */}
          <div className="rounded-3xl border border-slate-200 bg-[color:var(--posh-bg-card)] p-6 shadow-sm">
            <h2 className="report-display mb-4 text-xl text-slate-900">Purchase Detail</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    <th className="report-th pr-3">Date</th>
                    <th className="report-th pr-3">Order</th>
                    <th className="report-th pr-3">Site</th>
                    <th className="report-th pr-3">Supplier</th>
                    <th className="report-th pr-3">Item</th>
                    <th className="report-th pr-3 text-right">Qty</th>
                    <th className="report-th pr-3 text-right">Rate</th>
                    <th className="report-th pr-3 text-right">Taxable</th>
                    <th className="report-th pr-3 text-right">GST</th>
                    <th className="report-th pr-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail?.rows.map((row, idx) => (
                    <tr
                      key={`${row.orderId}-${idx}`}
                      className="border-b border-slate-100 transition-colors hover:bg-slate-50"
                    >
                      <td className="py-3 pr-3 font-medium text-slate-500">{row.orderDateLabel}</td>
                      <td className="py-3 pr-3">
                        <Link
                          href={`/orders/${row.orderId}`}
                          className="font-semibold text-[color:var(--posh-primary)] hover:underline"
                        >
                          {row.orderId.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="py-3 pr-3 font-semibold text-slate-800">{row.siteName}</td>
                      <td className="py-3 pr-3 font-medium text-slate-600">{row.supplierName}</td>
                      <td className="py-3 pr-3 font-semibold text-slate-800">{row.productName}</td>
                      <td className="py-3 pr-3 text-right font-medium text-slate-600">
                        {row.quantity} {row.unit}
                      </td>
                      <td className="py-3 pr-3 text-right font-medium text-slate-600">
                        {formatCurrency(row.unitPrice)}
                      </td>
                      <td className="py-3 pr-3 text-right font-medium text-slate-600">
                        {formatCurrency(row.taxableValue)}
                      </td>
                      <td className="py-3 pr-3 text-right font-medium text-slate-600">
                        {formatCurrency(row.gstAmount)}
                      </td>
                      <td className="report-display py-3 pr-3 text-right text-base text-slate-900">
                        {formatCurrency(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {detail && detail.totalRows > detail.pageSize ? (
              <div className="mt-5 flex items-center justify-between">
                <span className="report-label">
                  Page {detail.page} of {totalPages} · {detail.totalRows} rows
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={detail.page <= 1}
                    className="rounded-full border border-slate-200 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={detail.page >= totalPages}
                    className="rounded-full border border-slate-200 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
