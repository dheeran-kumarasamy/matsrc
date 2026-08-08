"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type AuditEvent = {
  id: string;
  actorId: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  target: string;
  createdAt: string;
  time: string;
};

const CATEGORIES = [
  "All",
  "Pricing",
  "Sources",
  "Endpoints",
  "Rollups",
  "Mappings",
  "Anomalies",
  "Compliance",
  "Users",
] as const;

function toCsv(rows: AuditEvent[]): string {
  const header = ["ID", "Actor", "Action", "Entity Type", "Entity Id", "Time"];
  const lines = rows.map((e) =>
    [e.id, e.actorId, e.action, e.entityType, e.entityId, e.createdAt]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AuditTimeline({
  events,
  loading,
  error,
}: {
  events: AuditEvent[];
  loading?: boolean;
  error?: string | null;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (!q) return true;
      return (
        e.actorId.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        e.entityType.toLowerCase().includes(q) ||
        e.entityId.toLowerCase().includes(q)
      );
    });
  }, [events, search]);

  function applyCategory(next: (typeof CATEGORIES)[number]) {
    setCategory(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "All") {
      params.delete("category");
    } else {
      params.set("category", next);
    }
    router.push(`/audit?${params.toString()}`);
  }

  function exportCsv() {
    downloadCsv(toCsv(filtered), `audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <section className="panel p-4" aria-label="Audit Trail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-950">Audit Trail</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-slate-600" htmlFor="audit-category">
            Category
          </label>
          <select
            id="audit-category"
            value={category}
            onChange={(e) => applyCategory(e.target.value as (typeof CATEGORIES)[number])}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actor, action, entity..."
            aria-label="Search audit log"
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        {loading ? (
          <p className="text-sm text-slate-500">Loading audit trail…</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
            No audit events match the current filters. Try a different category or search term, or check back after
            more admin actions have been performed.
          </p>
        ) : (
          filtered.map((event) => (
            <div key={event.id} className="flex gap-3">
              <div className="mt-1 h-3 w-3 rounded-full bg-slate-900" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {event.actor} {event.action}
                </p>
                <p className="text-sm text-slate-600">{event.target}</p>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{event.time}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
