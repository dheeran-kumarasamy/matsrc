"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApiPatch, adminApiPost } from "@/lib/api-client";
import type { PricingAdminSource } from "@/lib/pricing-admin-types";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function pct(value: number | null) {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

function money(value: number) {
  return `₹${value.toFixed(2)}`;
}

export function SourceManagementPanel({ sources }: { sources: PricingAdminSource[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  async function runAction(id: string, action: "enable" | "disable" | "pause" | "resume") {
    setBusyId(id);
    setError(null);
    try {
      await adminApiPatch(`/admin/pricing/sources/${id}/status`, { action });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} source.`);
    } finally {
      setBusyId(null);
    }
  }

  async function testConnection(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const result = await adminApiPost<{ ok: boolean; statusCode: number | null; errorMessage: string | null }>(
        `/admin/pricing/sources/${id}/test-connection`
      );
      setTestResult((prev) => ({
        ...prev,
        [id]: result.ok ? `OK (${result.statusCode})` : `Failed: ${result.errorMessage ?? result.statusCode ?? "unknown error"}`,
      }));
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [id]: "Test failed to run" }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Source Management</h3>
      <p className="mt-1 text-sm text-slate-600">
        Enable/disable/pause/resume scraping sources. Enabling requires ToS review, robots.txt allowance, and complete
        configuration (base URL + Apify actor). Every action is written to the audit log. Use the Endpoint Health panel
        below to force-run or view the run history of an individual endpoint for this source.
      </p>

      {error ? <p className="mt-2 text-xs font-semibold text-red-700">{error}</p> : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">License Class</th>
              <th className="py-2 pr-3">ToS Reviewed</th>
              <th className="py-2 pr-3">Robots</th>
              <th className="py-2 pr-3">Schedule</th>
              <th className="py-2 pr-3">Last Run</th>
              <th className="py-2 pr-3">Success/Fail Rate</th>
              <th className="py-2 pr-3">Avg Duration</th>
              <th className="py-2 pr-3">Cost (Month / Projected)</th>
              <th className="py-2 pr-3">Rows</th>
              <th className="py-2 pr-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-6 text-center text-sm text-slate-500">
                  No sources configured yet.
                </td>
              </tr>
            ) : (
              sources.map((source) => (
                <tr key={source.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    <p className="font-semibold text-slate-900">{source.name}</p>
                    <p className="text-xs text-slate-500">{source.code}</p>
                    {!source.configComplete ? (
                      <p className="mt-1 text-xs font-semibold text-amber-700">Config incomplete</p>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold ${
                        source.isEnabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {source.isEnabled ? "ENABLED" : "DISABLED"}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{source.licenseClass}</td>
                  <td className="py-2 pr-3">{formatDateTime(source.tosReviewedAt)}</td>
                  <td className="py-2 pr-3">{source.robotsAllowed ? "Allowed" : "Not Allowed"}</td>
                  <td className="py-2 pr-3">{source.cronExpression ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {formatDateTime(source.lastRunAt)}
                    <p className="text-xs text-slate-500">{source.lastRunStatus ?? "—"}</p>
                    {source.lastError ? (
                      <p className="mt-1 max-w-[220px] truncate text-xs text-red-700" title={source.lastError}>
                        {source.lastError}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    {pct(source.successRate)} / {pct(source.failureRate)}
                  </td>
                  <td className="py-2 pr-3">
                    {source.averageDurationMs !== null ? `${Math.round(source.averageDurationMs / 1000)}s` : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    {money(source.costThisMonth)} / {money(source.projectedCost)}
                  </td>
                  <td className="py-2 pr-3">
                    <p>Collected: {source.rowsCollected}</p>
                    <p>Parsed: {source.rowsParsed}</p>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {source.isEnabled ? (
                        <>
                          <button
                            type="button"
                            disabled={busyId === source.id}
                            onClick={() => void runAction(source.id, "pause")}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                          >
                            Pause
                          </button>
                          <button
                            type="button"
                            disabled={busyId === source.id}
                            onClick={() => void runAction(source.id, "disable")}
                            className="rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Disable
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === source.id}
                          onClick={() => void runAction(source.id, "enable")}
                          className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          Enable
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === source.id}
                        onClick={() => void testConnection(source.id)}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Test Connection
                      </button>
                    </div>
                    {testResult[source.id] ? (
                      <p className="mt-1 text-xs text-slate-600">{testResult[source.id]}</p>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
