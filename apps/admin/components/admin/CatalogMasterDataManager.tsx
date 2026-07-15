"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApiPatch, adminApiPost } from "@/lib/api-client";

type CatalogEntity = "category" | "brand" | "grade" | "unit";

type CatalogItem = {
  id: string;
  name: string;
  slug?: string | null;
  code?: string | null;
  isActive: boolean;
};

const TABS: { key: CatalogEntity; label: string }[] = [
  { key: "category", label: "Categories" },
  { key: "brand", label: "Brands" },
  { key: "grade", label: "Grades" },
  { key: "unit", label: "Units" },
];

export function CatalogMasterDataManager({
  initialData,
}: {
  initialData: Record<CatalogEntity, CatalogItem[]>;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<CatalogEntity>("category");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = initialData[activeTab] || [];
  const isUnit = activeTab === "unit";

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminApiPost(`/admin/catalog/${activeTab}`, {
        name: name.trim(),
        ...(isUnit && code.trim() ? { code: code.trim() } : {}),
      });
      setName("");
      setCode("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create item");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(item: CatalogItem) {
    setBusyId(item.id);
    setError(null);
    try {
      await adminApiPatch(`/admin/catalog/${activeTab}/${item.id}`, {
        isActive: !item.isActive,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update item");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-lg font-bold text-slate-950">Catalog Master Data</h3>
        <p className="mt-1 text-sm text-slate-500">
          Manage the standard set of Category, Brand, Grade and Unit values. Suppliers and builders can
          only select from these active values — no free text.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-4 pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              setName("");
              setCode("");
              setError(null);
            }}
            className={`rounded-t-lg px-3 py-2 text-sm font-semibold transition ${
              activeTab === tab.key
                ? "bg-white text-slate-950 border border-b-0 border-slate-200"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        <form onSubmit={handleCreate} className="mb-4 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {TABS.find((t) => t.key === activeTab)?.label.replace(/s$/, "")} name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${activeTab === "category" ? "Steel" : activeTab === "brand" ? "Ramco" : activeTab === "grade" ? "Fe500" : "Metric Ton"}`}
              className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>
          {isUnit && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Short code (optional)
              </label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. MT"
                className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {submitting ? "Adding..." : "Add"}
          </button>
        </form>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                {isUnit && <th className="px-4 py-3 font-semibold">Code</th>}
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={isUnit ? 4 : 3} className="px-4 py-6 text-center text-slate-400">
                    No {activeTab} entries yet.
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-800">{item.name}</td>
                  {isUnit && <td className="px-4 py-3 text-slate-700">{item.code}</td>}
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold ${
                        item.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {item.isActive ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void handleToggleActive(item)}
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                    >
                      {busyId === item.id ? "Saving..." : item.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
