"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApiDelete, adminApiGet, adminApiPut } from "@/lib/api-client";

type GlobalGst = { id: string; percentage: number; isEnabled: boolean; updatedAt: string } | null;
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

type GstData = {
  global: GlobalGst;
  categoryOverrides: CategoryOverride[];
  productOverrides: ProductOverride[];
};

type AdvanceConfig = { id: string; percentage: number; isEnabled: boolean; updatedAt: string } | null;

type CoverageRow = {
  productId: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  productSetting: { percentage: number; isEnabled: boolean } | null;
  effective: { source: "PRODUCT" | "CATEGORY" | "GLOBAL"; percentage: number } | null;
  missing: boolean;
  unresolvedReason: string | null;
  fallthroughNotices: string[];
};

type Tab = "global" | "category" | "product" | "coverage" | "advance";

// Product-Level GST / Advance Configuration — admin settings UI. Follows
// MarkupSettingsManager's exact structure/conventions (tabs, badges,
// feedback banners, loading/disabled states), extended with:
//   - a Product Tax-Coverage Worklist tab (identifies products blocking a
//     future confirmation flow — see GstService.listTaxCoverage)
//   - an Advance Configuration tab (informational-only; see
//     AdvanceConfigService's doc comment — this NEVER gates payment)
//
// Validation: only negative/NaN/non-finite percentages are rejected
// client-side (mirrors packages/db/lib/gst-rate-resolution.ts's
// isValidTaxPercent — no business-approved statutory ceiling exists, so
// none is silently enforced here either). The server performs the
// authoritative validation regardless of what this form allows through.
export function GstSettingsManager({
  initialData,
  initialAdvanceConfig,
  categories,
}: {
  initialData: GstData;
  initialAdvanceConfig: AdvanceConfig;
  categories: CatalogItem[];
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("global");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [globalPercentage, setGlobalPercentage] = useState(
    initialData.global ? String(initialData.global.percentage) : ""
  );
  const [globalEnabled, setGlobalEnabled] = useState(initialData.global?.isEnabled ?? true);

  const [categoryId, setCategoryId] = useState("");
  const [categoryPercentage, setCategoryPercentage] = useState("");
  const [categoryEnabled, setCategoryEnabled] = useState(true);

  const [productId, setProductId] = useState("");
  const [productPercentage, setProductPercentage] = useState("");
  const [productEnabled, setProductEnabled] = useState(true);

  const [advancePercentage, setAdvancePercentage] = useState(
    initialAdvanceConfig ? String(initialAdvanceConfig.percentage) : ""
  );
  const [advanceEnabled, setAdvanceEnabled] = useState(initialAdvanceConfig?.isEnabled ?? true);

  const [coverageRows, setCoverageRows] = useState<CoverageRow[] | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageOnlyMissing, setCoverageOnlyMissing] = useState(false);
  const [coveragePage, setCoveragePage] = useState(1);
  const [coverageTotal, setCoverageTotal] = useState(0);
  const coveragePageSize = 50;

  function clearFeedback() {
    setError(null);
    setSuccess(null);
  }

  function validatePercentage(raw: string): number | null {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || raw.trim() === "") {
      setError("Percentage must be a non-negative number (e.g. 0, 18, 12.5).");
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
      await adminApiPut("/admin/gst/global", { percentage, isEnabled: globalEnabled });
      setSuccess("Global GST default saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save global GST rate");
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
      await adminApiPut(`/admin/gst/category/${categoryId}`, { percentage, isEnabled: categoryEnabled });
      setSuccess("Category GST override saved.");
      setCategoryId("");
      setCategoryPercentage("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category GST rate");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteCategory(id: string) {
    clearFeedback();
    setSubmitting(true);
    try {
      await adminApiDelete(`/admin/gst/category/${id}`);
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
      await adminApiPut(`/admin/gst/product/${productId.trim()}`, { percentage, isEnabled: productEnabled });
      setSuccess("Product GST override saved.");
      setProductId("");
      setProductPercentage("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save product GST rate");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteProduct(id: string) {
    clearFeedback();
    setSubmitting(true);
    try {
      await adminApiDelete(`/admin/gst/product/${id}`);
      setSuccess("Product override removed — falls back to the category/global rule.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove product override");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveAdvanceConfig(e: React.FormEvent) {
    e.preventDefault();
    clearFeedback();
    const percentage = validatePercentage(advancePercentage);
    if (percentage === null) return;

    setSubmitting(true);
    try {
      await adminApiPut("/admin/gst/advance-config", { percentage, isEnabled: advanceEnabled });
      setSuccess("Advance configuration saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save advance configuration");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadCoverage(page: number, onlyMissing: boolean) {
    clearFeedback();
    setCoverageLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(coveragePageSize),
        onlyMissing: onlyMissing ? "true" : "false",
      });
      const result = await adminApiGet<{ rows: CoverageRow[]; total: number; page: number; pageSize: number }>(
        `/admin/gst/coverage?${params.toString()}`
      );
      setCoverageRows(result.rows);
      setCoverageTotal(result.total);
      setCoveragePage(result.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tax-coverage worklist");
    } finally {
      setCoverageLoading(false);
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "global", label: "Global Default" },
    { key: "category", label: "Category Overrides" },
    { key: "product", label: "Product Overrides" },
    { key: "coverage", label: "Tax Coverage Worklist" },
    { key: "advance", label: "Advance Configuration" },
  ];

  function gstBadge(percentage: number, isEnabled: boolean) {
    if (!isEnabled) {
      return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">DISABLED</span>;
    }
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
        {percentage}% {percentage === 0 ? "(explicit 0%)" : ""}
      </span>
    );
  }

  function effectiveBadge(effective: CoverageRow["effective"], missing: boolean) {
    if (missing || !effective) {
      return <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-700">MISSING</span>;
    }
    const sourceLabel = effective.source === "PRODUCT" ? "Product" : effective.source === "CATEGORY" ? "Category" : "Global";
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
        {effective.percentage}% ({sourceLabel})
      </span>
    );
  }

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-lg font-bold text-slate-950">Product-Level GST &amp; Advance Configuration</h3>
        <p className="mt-1 text-sm text-slate-500">
          GST is calculated on the marked-up buyer price. Precedence:{" "}
          <strong>Product override → Category override → Global default</strong>. A missing effective rate is never
          silently treated as 0% — it blocks order confirmation. An explicit 0% override is valid and distinct from
          leaving a scope unconfigured.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-4 pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              clearFeedback();
              if (tab.key === "coverage" && coverageRows === null) {
                void loadCoverage(1, coverageOnlyMissing);
              }
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
                gstBadge(initialData.global.percentage, initialData.global.isEnabled)
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                  NOT CONFIGURED
                </span>
              )}
            </div>
            <form onSubmit={handleSaveGlobal} className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  GST percentage
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={globalPercentage}
                  onChange={(e) => setGlobalPercentage(e.target.value)}
                  placeholder="e.g. 18"
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
                  placeholder="e.g. 12"
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
                  <th className="px-4 py-3 font-semibold">GST Rate</th>
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
                    <td className="px-4 py-3">{gstBadge(row.percentage, row.isEnabled)}</td>
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
                  <th className="px-4 py-3 font-semibold">GST Rate</th>
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
                    <td className="px-4 py-3">{gstBadge(row.percentage, row.isEnabled)}</td>
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

        {activeTab === "coverage" && (
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={coverageOnlyMissing}
                  onChange={(e) => {
                    setCoverageOnlyMissing(e.target.checked);
                    void loadCoverage(1, e.target.checked);
                  }}
                />
                Show only products missing an effective GST rate
              </label>
              <button
                type="button"
                onClick={() => void loadCoverage(coveragePage, coverageOnlyMissing)}
                disabled={coverageLoading}
                className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                {coverageLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {coverageLoading && <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>}

            {!coverageLoading && coverageRows !== null && (
              <>
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Product</th>
                      <th className="px-4 py-3 font-semibold">Category</th>
                      <th className="px-4 py-3 font-semibold">Effective GST</th>
                      <th className="px-4 py-3 font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverageRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                          {coverageOnlyMissing
                            ? "No products are missing an effective GST rate."
                            : "No active products found."}
                        </td>
                      </tr>
                    )}
                    {coverageRows.map((row) => (
                      <tr key={row.productId} className="border-t border-slate-100 align-top">
                        <td className="px-4 py-3 font-semibold text-slate-800">{row.productName}</td>
                        <td className="px-4 py-3 text-slate-600">{row.categoryName}</td>
                        <td className="px-4 py-3">{effectiveBadge(row.effective, row.missing)}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {row.missing && (
                            <p>
                              Blocks confirmation —{" "}
                              {row.unresolvedReason === "NO_SETTING_CONFIGURED"
                                ? "no GST setting configured at any scope."
                                : "every configured setting is disabled or invalid."}
                            </p>
                          )}
                          {row.fallthroughNotices.map((notice, i) => (
                            <p key={i}>{notice}</p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span>
                    Page {coveragePage} · {coverageTotal} total product{coverageTotal === 1 ? "" : "s"}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={coveragePage <= 1 || coverageLoading}
                      onClick={() => void loadCoverage(coveragePage - 1, coverageOnlyMissing)}
                      className="rounded-md border border-slate-300 px-3 py-1 font-semibold disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={coveragePage * coveragePageSize >= coverageTotal || coverageLoading}
                      onClick={() => void loadCoverage(coveragePage + 1, coverageOnlyMissing)}
                      className="rounded-md border border-slate-300 px-3 py-1 font-semibold disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}


        {activeTab === "advance" && (
          <div>
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <strong>Informational only.</strong> This percentage drives an informational &quot;suggested
              advance&quot; figure shown to the buyer. It never gates order confirmation, never debits the Advance
              Balance wallet, and never makes advance payment mandatory — every existing payment path remains fully
              optional.
            </div>
            <div className="mb-4 rounded-lg border border-slate-200 p-3 text-sm">
              <span className="font-semibold text-slate-700">Current configuration: </span>
              {initialAdvanceConfig ? (
                gstBadge(initialAdvanceConfig.percentage, initialAdvanceConfig.isEnabled)
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                  NOT CONFIGURED
                </span>
              )}
            </div>
            <form onSubmit={handleSaveAdvanceConfig} className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Required advance percentage
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={advancePercentage}
                  onChange={(e) => setAdvancePercentage(e.target.value)}
                  placeholder="e.g. 20"
                  className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={advanceEnabled} onChange={(e) => setAdvanceEnabled(e.target.checked)} />
                Enabled
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Save Advance Configuration"}
              </button>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
