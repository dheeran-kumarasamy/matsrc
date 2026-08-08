"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApiPost } from "@/lib/api-client";
import type { PricingRollupStatus } from "@/lib/pricing-admin-types";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

type PreviewResult = {
  observationsToProcess?: number;
  distinctSkuDistrictPairs?: number;
  [key: string]: unknown;
};

export function RollupAdministrationPanel({ status }: { status: PricingRollupStatus | null }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [priceDate, setPriceDate] = useState(today);
  const [monthStart, setMonthStart] = useState(today.slice(0, 8) + "01");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function runPreview() {
    setBusy("preview");
    setError(null);
    setPreview(null);
    try {
      const result = await adminApiPost<PreviewResult>("/admin/pricing/rollups/daily/preview", { priceDate });
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runDailyRollup() {
    setBusy("daily");
    setError(null);
    setLastResult(null);
    try {
      await adminApiPost("/admin/pricing/rollups/daily", { priceDate });
      setLastResult(`Daily rollup for ${priceDate} completed.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Daily rollup failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runMonthlyRollup() {
    setBusy("monthly");
    setError(null);
    setLastResult(null);
    try {
      await adminApiPost("/admin/pricing/rollups/monthly", { monthStart });
      setLastResult(`Monthly rollup for ${monthStart} completed.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Monthly rollup failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Rollup Administration</h3>
      <p className="mt-1 text-sm text-slate-600">
        Trigger daily/monthly rollups or run a dry-run preview before committing. Rollups run asynchronously on the
        server and do not block this UI. Granular rebuild-by-district/category/SKU is not yet available — rollups run
        for the full date/month.
      </p>

      {error ? <p className="mt-2 text-xs font-semibold text-red-700">{error}</p> : null}
      {lastResult ? <p className="mt-2 text-xs font-semibold text-emerald-700">{lastResult}</p> : null}

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-bold text-slate-800">Daily Rollup</p>
          <label className="mt-2 block text-xs font-semibold text-slate-700">
            Price date
            <input
              type="date"
              value={priceDate}
              onChange={(e) => setPriceDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void runPreview()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {busy === "preview" ? "Running preview..." : "Dry Run Preview"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void runDailyRollup()}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy === "daily" ? "Running..." : "Run Daily Rollup"}
            </button>
          </div>
          {preview ? (
            <div className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
              <p>Observations to process: {preview.observationsToProcess ?? "—"}</p>
              <p>Distinct SKU × District pairs: {preview.distinctSkuDistrictPairs ?? "—"}</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-bold text-slate-800">Monthly Rollup</p>
          <label className="mt-2 block text-xs font-semibold text-slate-700">
            Month start
            <input
              type="date"
              value={monthStart}
              onChange={(e) => setMonthStart(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="mt-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void runMonthlyRollup()}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy === "monthly" ? "Running..." : "Run Monthly Rollup"}
            </button>
          </div>
        </div>
      </div>

      <h4 className="mt-4 text-sm font-bold text-slate-700">Rollup History Summary</h4>
      {!status ? (
        <p className="mt-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
          Unable to load rollup status right now.
        </p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Last Daily Rollup</p>
            <p className="mt-1 text-sm font-bold text-slate-950">{formatDate(status.lastDailyRollupDate)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Last Monthly Rollup</p>
            <p className="mt-1 text-sm font-bold text-slate-950">{formatDate(status.lastMonthlyRollupMonth)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Total Daily Rows</p>
            <p className="mt-1 text-sm font-bold text-slate-950">{status.totalDailyRows}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Total Monthly Rows</p>
            <p className="mt-1 text-sm font-bold text-slate-950">{status.totalMonthlyRows}</p>
          </div>
        </div>
      )}
    </section>
  );
}
