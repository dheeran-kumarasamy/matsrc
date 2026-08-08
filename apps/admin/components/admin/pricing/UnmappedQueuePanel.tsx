"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminApiPost } from "@/lib/api-client";
import type { PricingUnmappedQueueItem } from "@/lib/pricing-admin-types";

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

function scoreLabel(score: number | null) {
  if (score === null) return "—";
  return `${Math.round(score * 100)}%`;
}

export function UnmappedQueuePanel({ items }: { items: PricingUnmappedQueueItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignInput, setAssignInput] = useState<Record<string, string>>({});
  const [newSkuInput, setNewSkuInput] = useState<Record<string, { code: string; categoryId: string }>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<"assign" | "merge" | "ignore" | "block">("ignore");
  const [bulkTargetId, setBulkTargetId] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.rawLabel.toLowerCase().includes(q) ||
        i.normalizedLabel.toLowerCase().includes(q) ||
        (i.source?.name ?? "").toLowerCase().includes(q)
    );
  }, [items, search]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function runAction(
    id: string,
    action: "assign" | "merge" | "ignore" | "block" | "create_new_sku",
    opts?: { canonicalSkuId?: string; newSkuCode?: string; materialCategoryId?: string }
  ) {
    setBusyId(id);
    setError(null);
    try {
      await adminApiPost(`/admin/pricing/sku/unmapped/${id}/action`, { action, ...opts });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} this alias.`);
    } finally {
      setBusyId(null);
    }
  }

  async function runBulkAction() {
    if (selectedIds.length === 0) {
      setError("Select at least one row for bulk processing.");
      return;
    }
    if ((bulkAction === "assign" || bulkAction === "merge") && !bulkTargetId.trim()) {
      setError("Enter a target canonical SKU id for bulk assign/merge.");
      return;
    }
    setBusyId("bulk");
    setError(null);
    try {
      await adminApiPost(`/admin/pricing/sku/unmapped/bulk-action`, {
        aliasIds: selectedIds,
        action: bulkAction,
        canonicalSkuId: bulkTargetId.trim() || undefined,
      });
      setSelectedIds([]);
      setBulkTargetId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to bulk process queue items.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel p-4" aria-label="Unmapped Queue">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-950">Unmapped Queue</h3>
          <p className="mt-1 text-sm text-slate-600">
            Raw price labels from ingestion that have not been linked to a canonical SKU. Every decision here is
            written to the audit log. Note: the underlying schema does not track a per-alias district, so the
            "District" column is not shown; "Suggested SKU" is approximated using the match type/score below since no
            dedicated suggestion field exists yet.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search raw label or source..."
          aria-label="Search unmapped queue"
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      {selectedIds.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 p-2 text-sm">
          <span className="font-semibold text-slate-700">{selectedIds.length} selected</span>
          <select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value as typeof bulkAction)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="ignore">Ignore</option>
            <option value="block">Block</option>
            <option value="assign">Assign</option>
            <option value="merge">Merge</option>
          </select>
          {(bulkAction === "assign" || bulkAction === "merge") ? (
            <input
              type="text"
              value={bulkTargetId}
              onChange={(e) => setBulkTargetId(e.target.value)}
              placeholder="Target canonical SKU id"
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
            />
          ) : null}
          <button
            type="button"
            disabled={busyId === "bulk"}
            onClick={() => void runBulkAction()}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Bulk Process
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="py-2 pr-3"> </th>
              <th className="py-2 pr-3">Raw Label</th>
              <th className="py-2 pr-3">Occurrences</th>
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">Suggested Match</th>
              <th className="py-2 pr-3">Similarity</th>
              <th className="py-2 pr-3">First Seen</th>
              <th className="py-2 pr-3">Last Seen</th>
              <th className="py-2 pr-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-6 text-center text-sm text-slate-500">
                  {items.length === 0
                    ? "No unmapped aliases. Ingestion has matched all raw labels to canonical SKUs."
                    : "No queue items match your search."}
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.rawLabel}`}
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelected(item.id)}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <p className="font-semibold text-slate-900">{item.rawLabel}</p>
                    <p className="text-xs text-slate-500">{item.normalizedLabel}</p>
                  </td>
                  <td className="py-2 pr-3">{item.occurrenceCount}</td>
                  <td className="py-2 pr-3">{item.source?.name ?? "—"}</td>
                  <td className="py-2 pr-3">{item.matchType}</td>
                  <td className="py-2 pr-3">{scoreLabel(item.matchScore)}</td>
                  <td className="py-2 pr-3">{formatDateTime(item.firstSeen)}</td>
                  <td className="py-2 pr-3">{formatDateTime(item.lastSeen)}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap gap-1">
                        <input
                          type="text"
                          placeholder="SKU id"
                          value={assignInput[item.id] ?? ""}
                          onChange={(e) => setAssignInput((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          className="w-20 rounded border border-slate-300 px-1 py-0.5 text-xs"
                        />
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() =>
                            void runAction(item.id, "assign", { canonicalSkuId: assignInput[item.id]?.trim() })
                          }
                          className="rounded border border-emerald-300 px-2 py-0.5 text-xs font-semibold text-emerald-700"
                        >
                          Assign
                        </button>
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() =>
                            void runAction(item.id, "merge", { canonicalSkuId: assignInput[item.id]?.trim() })
                          }
                          className="rounded border border-amber-300 px-2 py-0.5 text-xs font-semibold text-amber-700"
                        >
                          Merge
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void runAction(item.id, "ignore")}
                          className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-700"
                        >
                          Ignore
                        </button>
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void runAction(item.id, "block")}
                          className="rounded border border-red-300 px-2 py-0.5 text-xs font-semibold text-red-700"
                        >
                          Block
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <input
                          type="text"
                          placeholder="New SKU code"
                          value={newSkuInput[item.id]?.code ?? ""}
                          onChange={(e) =>
                            setNewSkuInput((prev) => ({
                              ...prev,
                              [item.id]: { code: e.target.value, categoryId: prev[item.id]?.categoryId ?? "" },
                            }))
                          }
                          className="w-24 rounded border border-slate-300 px-1 py-0.5 text-xs"
                        />
                        <input
                          type="text"
                          placeholder="Category id"
                          value={newSkuInput[item.id]?.categoryId ?? ""}
                          onChange={(e) =>
                            setNewSkuInput((prev) => ({
                              ...prev,
                              [item.id]: { code: prev[item.id]?.code ?? "", categoryId: e.target.value },
                            }))
                          }
                          className="w-20 rounded border border-slate-300 px-1 py-0.5 text-xs"
                        />
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() =>
                            void runAction(item.id, "create_new_sku", {
                              newSkuCode: newSkuInput[item.id]?.code?.trim(),
                              materialCategoryId: newSkuInput[item.id]?.categoryId?.trim(),
                            })
                          }
                          className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-700"
                        >
                          Create New SKU
                        </button>
                      </div>
                    </div>
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
