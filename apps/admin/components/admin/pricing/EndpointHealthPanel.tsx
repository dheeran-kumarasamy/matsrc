"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApiPatch, adminApiPost } from "@/lib/api-client";
import type { PricingAdminEndpoint } from "@/lib/pricing-admin-types";

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

export function EndpointHealthPanel({ endpoints }: { endpoints: PricingAdminEndpoint[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<Record<string, string>>({});

  async function runAction(id: string, action: "enable" | "disable" | "pause" | "resume") {
    setBusyId(id);
    setError(null);
    try {
      await adminApiPatch(`/admin/pricing/endpoints/${id}/status`, { action });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} endpoint.`);
    } finally {
      setBusyId(null);
    }
  }

  async function retry(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const result = await adminApiPost<{ itemsFetched?: number; status?: string }>(`/admin/pricing/endpoints/${id}/retry`);
      setRetryResult((prev) => ({
        ...prev,
        [id]: `Retried: ${result?.status ?? "done"} (${result?.itemsFetched ?? 0} items)`,
      }));
      router.refresh();
    } catch (err) {
      setRetryResult((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : "Retry failed" }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Endpoint Health</h3>
      <p className="mt-1 text-sm text-slate-600">
        Individual scrape endpoints (district × category × source). Endpoints auto-disable after repeated
        consecutive failures — these are highlighted below. Retry re-runs ingestion immediately for this endpoint.
      </p>

      {error ? <p className="mt-2 text-xs font-semibold text-red-700">{error}</p> : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="py-2 pr-3">Endpoint</th>
              <th className="py-2 pr-3">District</th>
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Last Fetched</th>
              <th className="py-2 pr-3">Consecutive Failures</th>
              <th className="py-2 pr-3">Disabled Reason</th>
              <th className="py-2 pr-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-6 text-center text-sm text-slate-500">
                  No endpoints configured yet.
                </td>
              </tr>
            ) : (
              endpoints.map((endpoint) => (
                <tr
                  key={endpoint.id}
                  className={`border-b align-top ${
                    endpoint.autoDisabled ? "border-red-100 bg-red-50/60" : "border-slate-100"
                  }`}
                >
                  <td className="py-2 pr-3">
                    <p className="max-w-[260px] truncate text-xs text-slate-700" title={endpoint.url}>
                      {endpoint.url}
                    </p>
                  </td>
                  <td className="py-2 pr-3">{endpoint.district ? `${endpoint.district.name} (${endpoint.district.code})` : "—"}</td>
                  <td className="py-2 pr-3">{endpoint.category ? `${endpoint.category.name} (${endpoint.category.code})` : "—"}</td>
                  <td className="py-2 pr-3">{endpoint.source.name}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`inline-block rounded-full px-2 py-1 text-xs font-bold ${
                          endpoint.isEnabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {endpoint.isEnabled ? "ENABLED" : "DISABLED"}
                      </span>
                      {endpoint.autoDisabled ? (
                        <span className="inline-block rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700">
                          AUTO-DISABLED
                        </span>
                      ) : null}
                      <span className="text-xs text-slate-500">{endpoint.lastStatus ?? "—"}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-3">{formatDateTime(endpoint.lastFetchedAt)}</td>
                  <td className="py-2 pr-3">
                    <span className={endpoint.consecutiveFailures > 0 ? "font-semibold text-red-700" : ""}>
                      {endpoint.consecutiveFailures}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {endpoint.disabledReason ? (
                      <p className="max-w-[200px] truncate text-xs text-red-700" title={endpoint.disabledReason}>
                        {endpoint.disabledReason}
                      </p>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busyId === endpoint.id}
                        onClick={() => void retry(endpoint.id)}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Retry
                      </button>
                      {endpoint.isEnabled ? (
                        <button
                          type="button"
                          disabled={busyId === endpoint.id}
                          onClick={() => void runAction(endpoint.id, "disable")}
                          className="rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Disable
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === endpoint.id}
                          onClick={() => void runAction(endpoint.id, "enable")}
                          className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          Enable
                        </button>
                      )}
                    </div>
                    {retryResult[endpoint.id] ? (
                      <p className="mt-1 max-w-[200px] text-xs text-slate-600">{retryResult[endpoint.id]}</p>
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
