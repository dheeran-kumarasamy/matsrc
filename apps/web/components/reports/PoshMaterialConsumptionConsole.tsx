"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Posh Material Consumption Report Console
//
// Two-pane layout adapted from github.com/dheeran-kumarasamy/posh-report-layout:
//   • Left sidebar — dark report navigation menu (224 px, desktop only)
//   • Right main panel — KPI row + data table + bar chart + insights panel,
//     all embedded in one viewport-fitting area (no excessive scrolling)
//
// This component is BRAND NEW — it does NOT touch or replace any existing
// report component (ReportCard, ReportsOverlay, etc.).
// Wired at: /reports/material-consumption
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { builderApiGet } from "@/lib/api";
import type { MaterialConsumptionRow } from "@/lib/reports-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/** Green < 14 d · Amber 14–60 d · Slate ≥ 60 d */
function rowStatus(iso: string): "ok" | "warn" | "idle" {
  const d = daysSince(iso);
  if (d <= 14) return "ok";
  if (d <= 60) return "warn";
  return "idle";
}

const STATUS_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-400",
  idle: "bg-slate-300",
};

// ── Navigation config ─────────────────────────────────────────────────────────
// href: null = this is the active embedded view (this page itself).
// All other items link to their existing pages — zero existing functionality changed.

const NAV_GROUPS = [
  {
    group: "Account Reports",
    items: [
      { id: "material-consumption", label: "Material Consumption", href: null },
      { id: "best-supplier-pricing", label: "Best Supplier Pricing", href: "/reports" },
      { id: "potential-cost-savings", label: "Cost Savings", href: "/reports" },
      { id: "site-wise", label: "Site-wise Purchase ↗", href: "/reports/site-wise" },
    ],
  },
  {
    group: "Market Intelligence",
    items: [
      { id: "live-market-prices", label: "Live Market Prices", href: "/reports" },
      { id: "regional-price-comparison", label: "Regional Comparison", href: "/reports" },
      { id: "historical-price-trends", label: "Historical Trends", href: "/reports" },
      { id: "district-price-intelligence", label: "District Intelligence", href: "/reports" },
    ],
  },
] as const;

// ── Main export ──────────────────────────────────────────────────────────────

export default function PoshMaterialConsumptionConsole() {
  const [rows, setRows] = useState<MaterialConsumptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    builderApiGet<MaterialConsumptionRow[]>("/reports/material-consumption")
      .then((data) => { if (!cancelled) setRows(data); })
      .catch(() => { if (!cancelled) setError("Could not load report. Please try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Derived metrics ──────────────────────────────────────────────────────
  const totalOrders = useMemo(() => rows.reduce((s, r) => s + r.orderCount, 0), [rows]);

  const lastOrdered = useMemo(() => {
    if (!rows.length) return "—";
    const maxMs = rows.reduce((max, r) => Math.max(max, new Date(r.lastOrderedAt).getTime()), 0);
    return new Date(maxMs).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  }, [rows]);

  // Top 7 for bar chart (already sorted desc by totalQuantity from API)
  const chartRows = rows.slice(0, 7);
  const maxQty = chartRows[0]?.totalQuantity ?? 1;

  const topCategories = useMemo(() => {
    const map: Record<string, { count: number; qty: number }> = {};
    for (const r of rows) {
      const cat = r.category || "Other";
      if (!map[cat]) map[cat] = { count: 0, qty: 0 };
      map[cat].count++;
      map[cat].qty += r.totalQuantity;
    }
    return Object.entries(map).sort((a, b) => b[1].qty - a[1].qty).slice(0, 3);
  }, [rows]);

  const staleCount = useMemo(
    () => rows.filter((r) => daysSince(r.lastOrderedAt) > 60).length,
    [rows]
  );

  return (
    // Fills the remaining viewport below the builder sticky header.
    // calc: top-4 padding (1rem) + ~68px sticky header + ~16px gap + bottom padding ≈ 7.5rem
    <div
      className="flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      style={{ height: "calc(100vh - 7.5rem)" }}
    >
      <ReportSidebar />
      <MainPanel
        loading={loading}
        error={error}
        rows={rows}
        totalOrders={totalOrders}
        lastOrdered={lastOrdered}
        chartRows={chartRows}
        maxQty={maxQty}
        topCategories={topCategories}
        staleCount={staleCount}
      />
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

type MainPanelProps = {
  loading: boolean;
  error: string | null;
  rows: MaterialConsumptionRow[];
  totalOrders: number;
  lastOrdered: string;
  chartRows: MaterialConsumptionRow[];
  maxQty: number;
  topCategories: [string, { count: number; qty: number }][];
  staleCount: number;
};

function MainPanel({ loading, error, rows, totalOrders, lastOrdered, chartRows, maxQty, topCategories, staleCount }: MainPanelProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Account Data · Material Consumption</p>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900">Material Consumption Report</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/reports" className="text-xs text-slate-500 transition-colors hover:text-slate-900 lg:hidden">← Reports</Link>
          <span className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-widest text-slate-400">Live</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {loading && (
          <div className="flex h-48 items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Loading…</p>
            </div>
          </div>
        )}
        {!loading && error && (
          <div className="rounded border border-red-100 bg-red-50 p-4 text-xs text-red-600">{error}</div>
        )}
        {!loading && !error && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Materials Tracked" value={String(rows.length)} note="unique products" />
              <KpiCard label="Total Order Lines" value={String(totalOrders)} note="across all orders" />
              <KpiCard label="Top Material" value={rows[0]?.name ?? "—"} note="highest volume" truncate />
              <KpiCard label="Last Ordered" value={lastOrdered} note={staleCount > 0 ? `${staleCount} need restocking` : "All materials recent"} tone={staleCount > 0 ? "warn" : "ok"} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_252px]">
              <DataTable rows={rows} />
              <RightPanel chartRows={chartRows} maxQty={maxQty} topCategories={topCategories} staleCount={staleCount} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Data table ────────────────────────────────────────────────────────────────

function DataTable({ rows }: { rows: MaterialConsumptionRow[] }) {
  return (
    <section className="overflow-hidden rounded border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Consumption Log</h2>
        <span className="font-mono text-[9px] font-semibold text-slate-400">{rows.length}&nbsp;material{rows.length !== 1 ? "s" : ""}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-xs text-slate-400">No order history yet — place an order to see this report.</p>
      ) : (
        <div className="max-h-[calc(100vh-28rem)] overflow-x-auto overflow-y-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-100">
                {["Material", "Category", "Qty Ordered", "Orders", "Last Ordered"].map((h) => (
                  <th key={h} className="px-5 py-3 text-[9px] font-bold uppercase tracking-wider text-slate-400">{h}</th>
                ))}
                <th className="px-5 py-3 text-right text-[9px] font-bold uppercase tracking-wider text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const st = rowStatus(row.lastOrderedAt);
                return (
                  <tr key={row.productId} className="transition-colors hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm font-medium text-slate-800">{row.name}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{row.category || "—"}</td>
                    <td className="px-5 py-3 font-mono text-sm tabular-nums text-slate-700">
                      {row.totalQuantity.toLocaleString("en-IN")}&nbsp;<span className="text-slate-400">{row.unit}</span>
                    </td>
                    <td className="px-5 py-3 font-mono text-sm tabular-nums text-slate-500">{row.orderCount}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {new Date(row.lastOrderedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[st]}`}
                        title={st === "ok" ? "Ordered recently (≤14 days)" : st === "warn" ? "Ordered 14–60 days ago" : "Not ordered in 60+ days"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Right panel: bar chart + dark insights ────────────────────────────────────

function RightPanel({ chartRows, maxQty, topCategories, staleCount }: {
  chartRows: MaterialConsumptionRow[];
  maxQty: number;
  topCategories: [string, { count: number; qty: number }][];
  staleCount: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* CSS-only bar chart */}
      <section className="rounded border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Volume Distribution</p>
            <p className="mt-0.5 text-sm font-semibold tracking-tight text-slate-900">Top Materials</p>
          </div>
          <span className="font-mono text-[9px] font-semibold text-emerald-500">by qty</span>
        </div>
        {chartRows.length === 0 ? (
          <p className="text-xs text-slate-400">No data yet.</p>
        ) : (
          <>
            <div className="flex h-24 items-end gap-1.5 px-1">
              {chartRows.map((r, i) => (
                <div
                  key={r.productId}
                  title={`${r.name}: ${r.totalQuantity.toLocaleString("en-IN")} ${r.unit}`}
                  style={{ height: `${Math.max(Math.round((r.totalQuantity / maxQty) * 100), 4)}%` }}
                  className={`flex-1 rounded-t transition-all ${i === 0 ? "bg-slate-900" : "bg-slate-200"}`}
                />
              ))}
            </div>
            <div className="mt-1.5 flex items-center justify-between font-mono text-[9px] text-slate-400">
              <span className="max-w-[80px] truncate">{chartRows[0]?.name?.split(" ")[0] ?? ""}</span>
              <span className="max-w-[80px] truncate text-right">{chartRows.at(-1)?.name?.split(" ")[0] ?? ""}</span>
            </div>
          </>
        )}
      </section>
      {/* Dark insights panel — mirrors "Active Alerts" from reference design */}
      <section className="rounded bg-slate-900 p-5 text-white">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          <h2 className="text-[9px] font-bold uppercase tracking-widest text-slate-300">Consumption Insights</h2>
        </div>
        <div className="space-y-4">
          {topCategories.length === 0 ? (
            <p className="text-[10px] text-slate-500">Place your first order to see insights here.</p>
          ) : (
            topCategories.map(([cat, { count, qty }]) => (
              <div key={cat} className="border-l border-white/20 pl-4">
                <p className="text-xs font-semibold text-slate-100">{cat}</p>
                <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                  {count}&nbsp;material{count !== 1 ? "s" : ""}&nbsp;·&nbsp;{qty.toLocaleString("en-IN")}&nbsp;units total
                </p>
              </div>
            ))
          )}
          {staleCount > 0 && (
            <div className="border-l border-amber-400/40 pl-4">
              <p className="text-xs font-semibold text-amber-300">Restocking Alert</p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                {staleCount}&nbsp;material{staleCount !== 1 ? "s" : ""}&nbsp;not ordered in 60+ days.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Left sidebar ─────────────────────────────────────────────────────────────

function ReportSidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col overflow-hidden border-r border-slate-800 bg-slate-900 lg:flex">
      {/* Sidebar header */}
      <div className="flex h-14 shrink-0 items-center border-b border-slate-800 px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-white">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-100">
            Reports
          </span>
        </div>
      </div>

      {/* Navigation groups */}
      <nav className="flex-1 overflow-y-auto p-3">
        {NAV_GROUPS.map(({ group, items }) => (
          <div key={group}>
            <p className="px-3 pb-1 pt-4 text-[9px] font-bold uppercase tracking-widest text-slate-500 first:pt-2">
              {group}
            </p>
            {items.map((item) => {
              const isActive = item.id === "material-consumption";
              if (isActive) {
                return (
                  <button
                    key={item.id}
                    aria-current="page"
                    className="flex w-full items-center gap-3 rounded bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 ring-1 ring-inset ring-slate-700"
                  >
                    <span className="h-3 w-3 shrink-0 rounded-sm bg-amber-400" />
                    {item.label}
                  </button>
                );
              }
              return (
                <Link
                  key={item.id}
                  href={item.href!}
                  className="flex w-full items-center gap-3 rounded px-3 py-2 text-xs text-slate-500 transition-colors hover:text-slate-200"
                >
                  <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-700" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-slate-800 p-4">
        <Link
          href="/reports"
          className="text-[9px] font-bold uppercase tracking-widest text-slate-500 transition-colors hover:text-slate-300"
        >
          ← All Reports
        </Link>
      </div>
    </aside>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  note,
  tone = "neutral",
  truncate = false,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "ok" | "warn" | "neutral";
  truncate?: boolean;
}) {
  const noteToneClass =
    tone === "ok"
      ? "text-emerald-500"
      : tone === "warn"
      ? "text-amber-500"
      : "text-slate-400";

  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p
        className={`mt-1.5 text-xl font-semibold tracking-tight text-slate-900 ${
          truncate ? "truncate" : ""
        }`}
      >
        {value}
      </p>
      {note && (
        <p className={`mt-0.5 font-mono text-[10px] ${noteToneClass}`}>{note}</p>
      )}
    </div>
  );
}
