"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApiDelete, adminApiPut } from "@/lib/api-client";

type GlobalMarkup = { id: string; percentage: number; isEnabled: boolean; updatedAt: string } | null;
type CategoryOverride = {
  id: string;
  categoryId: string;
  categoryName: string;
  percentage: number;
  isEnabled: boolean;
  updatedAt: string;
};
type ProductOverride = {
  id: string;
  productId: string;
  productName: string;
  percentage: number;
  isEnabled: boolean;
  updatedAt: string;
};
type CatalogItem = { id: string; name: string };

type MarkupData = {
  global: GlobalMarkup;
  categoryOverrides: CategoryOverride[];
  productOverrides: ProductOverride[];
};

type Tab = "global" | "category" | "product";

// Admin-Configurable Product Markup — admin settings UI.
//
// Precedence (product override -> category override -> global default) is
// explained inline so admins always understand "which rule is currently
// effective" without needing a separate lookup. An explicit 0% is saved
// and displayed distinctly from "not configured yet" (see the "Not
// configured" placeholder vs the "0%" badge).
//
// Validation: only negative/NaN/non-finite percentages are rejected
// client-side (mirrors packages/db/lib/markup-calculation.ts's
// isValidMarkupPercent — no business-approved upper ceiling exists, so
// none is silently enforced here either). The server performs the
// authoritative validation regardless of what this form allows through.
export function MarkupSettingsManager({
  initialData,
  categories,
}: {
  initialData: MarkupData;
  categories: CatalogItem[];
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("global");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Global form state
  const [globalPercentage, setGlobalPercentage] = useState(
    initialData.global ? String(initialData.global.percentage) : ""
  );
  const [globalEnabled, setGlobalEnabled] = useState(initialData.global?.isEnabled ?? true);

  // Category form state
  const [categoryId, setCategoryId] = useState("");
  const [categoryPercentage, setCategoryPercentage] = useState("");
  const [categoryEnabled, setCategoryEnabled] = useState(true);

  // Product form state
  const [productId, setProductId] = useState("");
  const [productPercentage, setProductPercentage] = useState("");
  const [productEnabled, setProductEnabled] = useState(true);

  function clearFeedback() {
    setError(null);
    setSuccess(null);
  }

  function validatePercentage(raw: string): number | null {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || raw.trim() === "") {
      setError("Percentage must be a non-negative number (e.g. 0, 10, 12.5).");
      return null;
    }
    return value;
  }

  async function handleSaveGlobal(e: React.FormEvent) {
    e.preventDefault();
    clearFeedback();
    const percentage = validatePercentage(globalPercentage);
    if (percentage === null) return;

    setSubmitting(true);
    try {
      await adminApiPut("/admin/markup/global", { percentage, isEnabled: globalEnabled });
      setSuccess("Global default markup saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save global markup");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveCategory(e: React.FormEvent) {
    e.preventDefault();
    clearFeedback();
    if (!categoryId) {
      setError("Select a category.");
      return;
    }
    const percentage = validatePercentage(categoryPercentage);
    if (percentage === null) return;

    setSubmitting(true);
    try {
      await adminApiPut(`/admin/markup/category/${categoryId}`, { percentage, isEnabled: categoryEnabled });
      setSuccess("Category markup override saved.");
      setCategoryId("");
      setCategoryPercentage("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category markup");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteCategory(id: string) {
    clearFeedback();
    setSubmitting(true);
    try {
      await adminApiDelete(`/admin/markup/category/${id}`);
      setSuccess("Category override removed — falls back to the global default.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove category override");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    clearFeedback();
    if (!productId.trim()) {
      setError("Enter a product id.");
      return;
    }
    const percentage = validatePercentage(productPercentage);
    if (percentage === null) return;

    setSubmitting(true);
    try {
      await adminApiPut(`/admin/markup/product/${productId.trim()}`, { percentage, isEnabled: productEnabled });
      setSuccess("Product markup override saved.");
      setProductId("");
      setProductPercentage("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save product markup");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteProduct(id: string) {
    clearFeedback();
    setSubmitting(true);
    try {
      await adminApiDelete(`/admin/markup/product/${id}`);
      setSuccess("Product override removed — falls back to the category/global rule.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove product override");
    } finally {
      setSubmitting(false);
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "global", label: "Global Default" },
    { key: "category", label: "Category Overrides" },
    { key: "product", label: "Product Overrides" },
  ];

  function markupBadge(percentage: number, isEnabled: boolean) {
    if (!isEnabled) {
      return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">DISABLED</span>;
    }
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
        {percentage}% {percentage === 0 ? "(explicit 0%)" : ""}
      </span>
    );
  }

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-lg font-bold text-slate-950">Product Markup</h3>
        <p className="mt-1 text-sm text-slate-500">
          Buyer Unit Price = Supplier Unit Price × (1 + Markup % / 100). Precedence:{" "}
          <strong>Product override → Category override → Global default</strong>. An explicit 0% override is valid
          and distinct from leaving a scope unconfigured.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-4 pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              clearFeedback();
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
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
        {success && (
          <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{success}</p>
        )}

        {activeTab === "global" && (
          <div>
            <div className="mb-4 rounded-lg border border-slate-200 p-3 text-sm">
              <span className="font-semibold text-slate-700">Current global default: </span>
              {initialData.global ? (
                markupBadge(initialData.global.percentage, initialData.global.isEnabled)
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                  NOT CONFIGURED
                </span>
              )}
            </div>
            <form onSubmit={handleSaveGlobal} className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Markup percentage
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={globalPercentage}
                  onChange={(e) => setGlobalPercentage(e.target.value)}
                  placeholder="e.g. 10"
                  className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={globalEnabled} onChange={(e) => setGlobalEnabled(e.target.checked)} />
                Enabled
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Save Global Default"}
              </button>
            </form>
          </div>
        )}

        {activeTab === "category" && (
          <div>
            <form onSubmit={handleSaveCategory} className="mb-4 flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select category…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Percentage</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={categoryPercentage}
                  onChange={(e) => setCategoryPercentage(e.target.value)}
                  placeholder="e.g. 15"
                  className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={categoryEnabled}
                  onChange={(e) => setCategoryEnabled(e.target.checked)}
                />
                Enabled
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Save Override"}
              </button>
            </form>

            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Markup</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {initialData.categoryOverrides.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                      No category overrides configured — all categories use the global default.
                    </td>
                  </tr>
                )}
                {initialData.categoryOverrides.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.categoryName}</td>
                    <td className="px-4 py-3">{markupBadge(row.percentage, row.isEnabled)}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleDeleteCategory(row.categoryId)}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "product" && (
          <div>
            <form onSubmit={handleSaveProduct} className="mb-4 flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Product ID</label>
                <input
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  placeholder="Product cuid"
                  className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Percentage</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={productPercentage}
                  onChange={(e) => setProductPercentage(e.target.value)}
                  placeholder="e.g. 5"
                  className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={productEnabled} onChange={(e) => setProductEnabled(e.target.checked)} />
                Enabled
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Save Override"}
              </button>
            </form>

            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Product</th>
                  <th className="px-4 py-3 font-semibold">Markup</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {initialData.productOverrides.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                      No product overrides configured.
                    </td>
                  </tr>
                )}
                {initialData.productOverrides.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.productName}</td>
                    <td className="px-4 py-3">{markupBadge(row.percentage, row.isEnabled)}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleDeleteProduct(row.productId)}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

