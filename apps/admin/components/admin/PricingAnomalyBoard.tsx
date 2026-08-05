"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApiPost } from "@/lib/api-client";

export type AdminPricingAnomaly = {
  id: string;
  reason: string;
  detail: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  resolutionAction: string | null;
  canonicalSkuCode: string | null;
  districtCode: string | null;
  districtName: string | null;
  sourceCode: string | null;
  sourceName: string | null;
};

const RESOLUTION_ACTIONS = [
  { value: "accepted", label: "Accept (was legitimate)" },
  { value: "excluded", label: "Confirm Exclude" },
  { value: "remapped", label: "Remapped SKU/District" },
  { value: "source_fixed", label: "Source Fixed" },
] as const;

function reasonBadgeClasses(reason: string) {
  switch (reason) {
    case "OUTLIER_MAD":
    case "IMPLAUSIBLE_RANGE":
      return "bg-red-50 text-red-700";
    case "UNIT_AMBIGUOUS":
    case "SOURCE_SCHEMA_DRIFT":
      return "bg-amber-50 text-amber-700";
    case "STALE_AS_OF":
      return "bg-blue-50 text-blue-700";
    case "DUPLICATE_SUSPECT":
      return "bg-purple-50 text-purple-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

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

export function PricingAnomalyBoard({ anomalies }: { anomalies: AdminPricingAnomaly[] }) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [action, setAction] = useState<string>(RESOLUTION_ACTIONS[0].value);
  const [note, setNote] = useState("");
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openResolveDialog(id: string) {
    setActiveId(id);
    setAction(RESOLUTION_ACTIONS[0].value);
    setNote("");
    setError(null);
  }

  function closeResolveDialog() {
    setActiveId(null);
    setNote("");
    setError(null);
  }

  async function submitResolve(id: string) {
    setSubmittingId(id);
    setError(null);
    try {
      await adminApiPost(`/admin/pricing/anomalies/${id}/resolve`, {
        action,
        note: note.trim() || undefined,
      });
      closeResolveDialog();
      router.refresh();
    } catch {
      setError("Unable to resolve this anomaly right now.");
    } finally {
      setSubmittingId(null);
    }
  }

  const unresolved = anomalies.filter((a) => !a.resolvedAt);
  const resolved = anomalies.filter((a) => a.resolvedAt);

  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Pricing Anomalies</h3>
      <p className="mt-1 text-sm text-slate-600">
        Flagged price observations from the district price intelligence ingestion pipeline. Review and resolve to control whether the underlying observation contributes to the next rollup.
      </p>

      <div className="mt-3 space-y-3">
        {unresolved.length === 0 ? (
          <p className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">No unresolved anomalies. 🎉</p>
        ) : (
          unresolved.map((anomaly) => (
            <article key={anomaly.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {anomaly.canonicalSkuCode || "Unknown SKU"} · {anomaly.districtName || anomaly.districtCode || "Unknown district"}
                  </p>
                  <p className="text-sm text-slate-600">{anomaly.detail || "No additional detail provided."}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${reasonBadgeClasses(anomaly.reason)}`}>
                  {anomaly.reason.replace(/_/g, " ")}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
                <span>Source: {anomaly.sourceName || anomaly.sourceCode || "—"}</span>
                <span>Detected: {formatDateTime(anomaly.detectedAt)}</span>
              </div>

              <div className="mt-3">
                {activeId === anomaly.id ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <label className="block text-xs font-semibold text-slate-700">
                      Resolution action
                      <select
                        value={action}
                        onChange={(e) => setAction(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        {RESOLUTION_ACTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs font-semibold text-slate-700">
                      Note (optional)
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="e.g. Verified with source directly"
                      />
                    </label>
                    {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={submittingId === anomaly.id}
                        onClick={() => void submitResolve(anomaly.id)}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {submittingId === anomaly.id ? "Resolving..." : "Confirm Resolve"}
                      </button>
                      <button
                        type="button"
                        onClick={closeResolveDialog}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openResolveDialog(anomaly.id)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Resolve
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      {resolved.length > 0 ? (
        <div className="mt-6">
          <h4 className="text-sm font-bold text-slate-700">Recently Resolved</h4>
          <div className="mt-2 space-y-2">
            {resolved.slice(0, 10).map((anomaly) => (
              <div key={anomaly.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">
                <span className="font-semibold text-slate-800">
                  {anomaly.canonicalSkuCode || "Unknown SKU"} · {anomaly.districtName || anomaly.districtCode || "Unknown district"}
                </span>{" "}
                — {anomaly.resolutionAction} ({formatDateTime(anomaly.resolvedAt)})
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
