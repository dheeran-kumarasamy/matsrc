"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApiPost } from "@/lib/api-client";
import type { PricingSchedulerStatus } from "@/lib/pricing-admin-types";

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

function statusBadgeClasses(status: string) {
  switch (status) {
    case "SUCCESS":
    case "COMPLETED":
      return "bg-emerald-50 text-emerald-700";
    case "FAILED":
      return "bg-red-50 text-red-700";
    case "RUNNING":
      return "bg-blue-50 text-blue-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function toCsv(status: PricingSchedulerStatus) {
  const header = [
    "Source",
    "Source Code",
    "Status",
    "Started",
    "Finished",
    "Duration (ms)",
    "Triggered By",
    "Items Fetched",
    "Error",
  ];
  const rows = status.recentRuns.map((run) => [
    run.sourceName,
    run.sourceCode,
    run.status,
    run.startedAt ?? "",
    run.finishedAt ?? "",
    run.durationMs !== null ? String(run.durationMs) : "",
    run.triggeredBy ?? "",
    String(run.itemsFetched),
    run.errorMessage ?? "",
  ]);
  return [header, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function SchedulerDashboardPanel({ status }: { status: PricingSchedulerStatus | null }) {
  const router = useRouter();
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runJobAction(name: string, action: "pause" | "resume") {
    setBusyJob(name);
    setError(null);
    try {
      await adminApiPost(`/admin/pricing/scheduler/${name}/${action}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} job.`);
    } finally {
      setBusyJob(null);
    }
  }

  if (!status) {
    return (
      <section className="panel p-4">
        <h3 className="text-lg font-bold text-slate-950">Scheduler Dashboard</h3>
        <p className="mt-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
          Unable to load scheduler status right now. Try refreshing the page.
        </p>
      </section>
    );
  }

  const { jobs, recentRuns } = status;

  const handleExportCsv = () => {
    const csv = toCsv(status);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "scheduler-runs.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-slate-950">Scheduler Dashboard</h3>
        <button
          type="button"
          onClick={handleExportCsv}
          aria-label="Export scheduler runs as CSV"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Cron-registered ingestion jobs and recent scrape run history. Retry/Cancel of an individual run are not
        currently available — use Endpoint Health → Retry to re-run a specific endpoint instead.
      </p>

      {error ? <p className="mt-2 text-xs font-semibold text-red-700">{error}</p> : null}

      <h4 className="mt-4 text-sm font-bold text-slate-700">Jobs</h4>
      {jobs.length === 0 ? (
        <p className="mt-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500">No scheduled jobs registered.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {jobs.map((job) => (
            <div
              key={job.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">{job.name}</p>
                <p className="text-xs text-slate-500">Next execution: {formatDateTime(job.nextExecution)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-bold ${
                    job.running ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {job.running ? "RUNNING" : "PAUSED"}
                </span>
                {job.running ? (
                  <button
                    type="button"
                    disabled={busyJob === job.name}
                    onClick={() => void runJobAction(job.name, "pause")}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyJob === job.name}
                    onClick={() => void runJobAction(job.name, "resume")}
                    className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    Resume
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <h4 className="mt-4 text-sm font-bold text-slate-700">Recent Runs</h4>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Started</th>
              <th className="py-2 pr-3">Finished</th>
              <th className="py-2 pr-3">Duration</th>
              <th className="py-2 pr-3">Triggered By</th>
              <th className="py-2 pr-3">Items Fetched</th>
              <th className="py-2 pr-3">Error</th>
            </tr>
          </thead>
          <tbody>
            {recentRuns.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-sm text-slate-500">
                  No scheduler runs recorded yet.
                </td>
              </tr>
            ) : (
              recentRuns.map((run) => (
                <tr key={run.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    <p className="font-semibold text-slate-900">{run.sourceName}</p>
                    <p className="text-xs text-slate-500">{run.sourceCode}</p>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusBadgeClasses(run.status)}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{formatDateTime(run.startedAt)}</td>
                  <td className="py-2 pr-3">{formatDateTime(run.finishedAt)}</td>
                  <td className="py-2 pr-3">{run.durationMs !== null ? `${Math.round(run.durationMs / 1000)}s` : "—"}</td>
                  <td className="py-2 pr-3">{run.triggeredBy ?? "—"}</td>
                  <td className="py-2 pr-3">{run.itemsFetched}</td>
                  <td className="py-2 pr-3">
                    {run.errorMessage ? (
                      <p className="max-w-[200px] truncate text-xs text-red-700" title={run.errorMessage}>
                        {run.errorMessage}
                      </p>
                    ) : (
                      "—"
                    )}
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
