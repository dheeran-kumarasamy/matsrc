"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminApiGet, adminApiPost } from "@/lib/api-client";
import type { AdminAuditEntry, PricingCanonicalSkuAdmin } from "@/lib/pricing-admin-types";

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

function aliasBadgeClasses(matchType: string) {
  switch (matchType) {
    case "EXACT":
    case "MANUAL":
      return "bg-emerald-50 text-emerald-700";
    case "FUZZY":
      return "bg-amber-50 text-amber-700";
    case "BLOCKED":
      return "bg-red-50 text-red-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function CanonicalSkuManagementPanel({ skus }: { skus: PricingCanonicalSkuAdmin[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renameOpenId, setRenameOpenId] = useState<string | null>(null);
  const [renameCode, setRenameCode] = useState("");
  const [renameGrade, setRenameGrade] = useState("");
  const [mergeOpenId, setMergeOpenId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<AdminAuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [aliasCanonicalInput, setAliasCanonicalInput] = useState<Record<string, string>>({});
  const [selectedAliasIds, setSelectedAliasIds] = useState<string[]>([]);
  const [bulkTargetId, setBulkTargetId] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skus;
    return skus.filter(
      (s) =>
        s.code.toLowerCase().includes(q) ||
        (s.grade ?? "").toLowerCase().includes(q) ||
        s.aliases.some((a) => a.rawLabel.toLowerCase().includes(q))
    );
  }, [skus, search]);

  async function doRename(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await adminApiPost(`/admin/pricing/sku/canonical/${id}/rename`, {
        code: renameCode.trim(),
        grade: renameGrade.trim() || undefined,
      });
      setRenameOpenId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rename SKU.");
    } finally {
      setBusyId(null);
    }
  }

  async function doMerge(id: string) {
    if (!mergeTargetId.trim()) {
      setError("Enter a target canonical SKU id to merge into.");
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await adminApiPost(`/admin/pricing/sku/canonical/${id}/merge`, {
        targetSkuId: mergeTargetId.trim(),
      });
      setMergeOpenId(null);
      setMergeTargetId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to merge SKU.");
    } finally {
      setBusyId(null);
    }
  }

  async function loadHistory(id: string) {
    setHistoryOpenId(id);
    setHistoryLoading(true);
    try {
      const rows = await adminApiGet<AdminAuditEntry[]>(`/admin/pricing/sku/canonical/${id}/history`);
      setHistory(rows);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function aliasAction(aliasId: string, action: "approve" | "reject" | "block") {
    setBusyId(aliasId);
    setError(null);
    try {
      await adminApiPost(`/admin/pricing/sku/alias/${aliasId}/action`, {
        action,
        canonicalSkuId: action === "approve" ? aliasCanonicalInput[aliasId]?.trim() || undefined : undefined,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} alias.`);
    } finally {
      setBusyId(null);
    }
  }

  function toggleAliasSelected(id: string) {
    setSelectedAliasIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function bulkAssign() {
    if (selectedAliasIds.length === 0 || !bulkTargetId.trim()) {
      setError("Select at least one alias and a target SKU id for bulk assign.");
      return;
    }
    setBusyId("bulk");
    setError(null);
    try {
      await adminApiPost(`/admin/pricing/sku/alias/bulk-assign`, {
        aliasIds: selectedAliasIds,
        canonicalSkuId: bulkTargetId.trim(),
      });
      setSelectedAliasIds([]);
      setBulkTargetId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to bulk assign aliases.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel p-4" aria-label="Canonical SKU Management">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-950">Canonical SKU Management</h3>
          <p className="mt-1 text-sm text-slate-600">
            Manage canonical SKUs, merge duplicates, rename, and approve/reject/block raw aliases. Fuzzy matches are
            never auto-approved — an explicit target SKU is required to approve an alias. <strong>Split</strong> is not
            yet supported (no safe schema-level operation exists to divide observation history between two SKUs);
            use Merge in reverse via manual reassignment if needed, or contact engineering.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code, grade or alias..."
          aria-label="Search canonical SKUs"
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      {selectedAliasIds.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 p-2 text-sm">
          <span className="font-semibold text-slate-700">{selectedAliasIds.length} alias(es) selected</span>
          <input
            type="text"
            value={bulkTargetId}
            onChange={(e) => setBulkTargetId(e.target.value)}
            placeholder="Target canonical SKU id"
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={busyId === "bulk"}
            onClick={() => void bulkAssign()}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Bulk Assign
          </button>
          <button
            type="button"
            onClick={() => setSelectedAliasIds([])}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
          >
            Clear Selection
          </button>
        </div>
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="py-2 pr-3">Canonical SKU</th>
              <th className="py-2 pr-3">Aliases</th>
              <th className="py-2 pr-3">Products Linked</th>
              <th className="py-2 pr-3">District Coverage</th>
              <th className="py-2 pr-3">Observations</th>
              <th className="py-2 pr-3">Last Seen</th>
              <th className="py-2 pr-3">Confidence</th>
              <th className="py-2 pr-3">Unmapped</th>
              <th className="py-2 pr-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-6 text-center text-sm text-slate-500">
                  {skus.length === 0
                    ? "No canonical SKUs found yet. SKUs are created automatically during ingestion, or manually from the Unmapped Queue."
                    : "No canonical SKUs match your search."}
                </td>
              </tr>
            ) : (
              filtered.map((sku) => (
                <tr key={sku.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    <p className="font-semibold text-slate-900">{sku.code}</p>
                    <p className="text-xs text-slate-500">
                      {sku.grade ?? "—"} {sku.sizeLabel ? `· ${sku.sizeLabel}` : ""}
                    </p>
                    <p className="text-xs text-slate-500">{sku.materialCategory?.name ?? "—"}</p>
                    {!sku.isActive ? (
                      <span className="mt-1 inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        Merged / Inactive
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    <ul className="space-y-1">
                      {sku.aliases.length === 0 ? (
                        <li className="text-xs text-slate-400">No aliases</li>
                      ) : (
                        sku.aliases.slice(0, 5).map((alias) => (
                          <li key={alias.id} className="flex flex-wrap items-center gap-1">
                            <input
                              type="checkbox"
                              aria-label={`Select alias ${alias.rawLabel}`}
                              checked={selectedAliasIds.includes(alias.id)}
                              onChange={() => toggleAliasSelected(alias.id)}
                            />
                            <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${aliasBadgeClasses(alias.matchType)}`}>
                              {alias.rawLabel}
                            </span>
                            <button
                              type="button"
                              disabled={busyId === alias.id}
                              onClick={() => void aliasAction(alias.id, "reject")}
                              className="text-xs text-slate-500 underline"
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              disabled={busyId === alias.id}
                              onClick={() => void aliasAction(alias.id, "block")}
                              className="text-xs text-red-600 underline"
                            >
                              Block
                            </button>
                            <input
                              type="text"
                              placeholder="Approve → SKU id"
                              value={aliasCanonicalInput[alias.id] ?? ""}
                              onChange={(e) =>
                                setAliasCanonicalInput((prev) => ({ ...prev, [alias.id]: e.target.value }))
                              }
                              className="w-24 rounded border border-slate-300 px-1 py-0.5 text-xs"
                            />
                            <button
                              type="button"
                              disabled={busyId === alias.id}
                              onClick={() => void aliasAction(alias.id, "approve")}
                              className="text-xs font-semibold text-emerald-700 underline"
                            >
                              Approve
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </td>
                  <td className="py-2 pr-3">{sku.productsLinked}</td>
                  <td className="py-2 pr-3">{sku.districtCoverage}</td>
                  <td className="py-2 pr-3">{sku.observationCount}</td>
                  <td className="py-2 pr-3">{formatDateTime(sku.lastSeen)}</td>
                  <td className="py-2 pr-3">{sku.confidence}</td>
                  <td className="py-2 pr-3">{sku.unmappedCount}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setRenameOpenId(renameOpenId === sku.id ? null : sku.id);
                          setRenameCode(sku.code);
                          setRenameGrade(sku.grade ?? "");
                        }}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => setMergeOpenId(mergeOpenId === sku.id ? null : sku.id)}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Merge
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadHistory(sku.id)}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        History
                      </button>

                      {renameOpenId === sku.id ? (
                        <div className="mt-1 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <input
                            type="text"
                            value={renameCode}
                            onChange={(e) => setRenameCode(e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            placeholder="Code"
                          />
                          <input
                            type="text"
                            value={renameGrade}
                            onChange={(e) => setRenameGrade(e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            placeholder="Grade (optional)"
                          />
                          <button
                            type="button"
                            disabled={busyId === sku.id}
                            onClick={() => void doRename(sku.id)}
                            className="w-full rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      ) : null}

                      {mergeOpenId === sku.id ? (
                        <div className="mt-1 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <input
                            type="text"
                            value={mergeTargetId}
                            onChange={(e) => setMergeTargetId(e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            placeholder="Target canonical SKU id"
                          />
                          <button
                            type="button"
                            disabled={busyId === sku.id}
                            onClick={() => void doMerge(sku.id)}
                            className="w-full rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Merge Into Target
                          </button>
                        </div>
                      ) : null}

                      {historyOpenId === sku.id ? (
                        <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                          {historyLoading ? (
                            <p>Loading…</p>
                          ) : history.length === 0 ? (
                            <p className="text-slate-500">No audit history for this SKU.</p>
                          ) : (
                            history.map((h) => (
                              <p key={h.id} className="border-b border-slate-200 py-1 last:border-0">
                                <span className="font-semibold">{h.action}</span> — {formatDateTime(h.createdAt)} (
                                {h.actorId})
                              </p>
                            ))
                          )}
                        </div>
                      ) : null}
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
