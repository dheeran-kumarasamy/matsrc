"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminApiPatch, adminApiPost, adminApiPut } from "@/lib/api-client";

type CatalogEntity = "category" | "brand" | "grade" | "unit";
type ActiveTab = CatalogEntity | "products" | "order-splitting";

export type CatalogItem = {
  id: string;
  name: string;
  slug?: string | null;
  code?: string | null;
  isActive: boolean;
  isOrderable?: boolean;
};

export type CatalogProduct = {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  category: { id: string; name: string };
  supplierId: string;
  supplier: { id: string; companyName: string };
  basePrice: number | string;
  stock: number;
  unit: string;
  isActive: boolean;
  isOrderable: boolean;
};

export type OrderSplittingConfig = {
  id: string;
  allowMultiSupplierSplitting: boolean;
  splitOnlyAcrossCategories: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
};

const TABS: { key: ActiveTab; label: string }[] = [
  { key: "category", label: "Categories" },
  { key: "brand", label: "Brands" },
  { key: "grade", label: "Grades" },
  { key: "unit", label: "Units" },
  { key: "products", label: "Products & Ordering" },
  { key: "order-splitting", label: "Order Splitting Settings" },
];

export function CatalogMasterDataManager({
  initialData,
  initialProducts = [],
  initialOrderSplittingConfig,
}: {
  initialData: Record<CatalogEntity, CatalogItem[]>;
  initialProducts?: CatalogProduct[];
  initialOrderSplittingConfig?: OrderSplittingConfig | null;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActiveTab>("category");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Products tab filter state
  const [productSearch, setProductSearch] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("ALL");
  const [selectedOrderableFilter, setSelectedOrderableFilter] = useState<"ALL" | "ALLOWED" | "DISABLED">("ALL");

  // Order Splitting Config state
  const [allowMultiSupplierSplitting, setAllowMultiSupplierSplitting] = useState(
    initialOrderSplittingConfig?.allowMultiSupplierSplitting ?? false
  );
  const [splitOnlyAcrossCategories, setSplitOnlyAcrossCategories] = useState(
    initialOrderSplittingConfig?.splitOnlyAcrossCategories ?? true
  );
  const [savingConfig, setSavingConfig] = useState(false);

  const isMasterTab = activeTab === "category" || activeTab === "brand" || activeTab === "grade" || activeTab === "unit";
  const items = isMasterTab ? initialData[activeTab as CatalogEntity] || [] : [];
  const isUnit = activeTab === "unit";
  const isCategory = activeTab === "category";

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !isMasterTab) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
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
    if (!isMasterTab) return;
    setBusyId(item.id);
    setError(null);
    setSuccess(null);
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

  async function handleToggleCategoryOrderable(item: CatalogItem) {
    setBusyId(`orderable-${item.id}`);
    setError(null);
    setSuccess(null);
    try {
      const nextOrderable = item.isOrderable === false ? true : false;
      await adminApiPatch(`/admin/catalog/category/${item.id}`, {
        isOrderable: nextOrderable,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update category ordering");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleProductOrderable(product: CatalogProduct) {
    setBusyId(`prod-orderable-${product.id}`);
    setError(null);
    setSuccess(null);
    try {
      await adminApiPatch(`/admin/catalog/products/${product.id}`, {
        isOrderable: !product.isOrderable,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update product ordering");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleProductActive(product: CatalogProduct) {
    setBusyId(`prod-active-${product.id}`);
    setError(null);
    setSuccess(null);
    try {
      await adminApiPatch(`/admin/catalog/products/${product.id}`, {
        isActive: !product.isActive,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update product status");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveOrderSplittingConfig(e: React.FormEvent) {
    e.preventDefault();
    setSavingConfig(true);
    setError(null);
    setSuccess(null);
    try {
      await adminApiPut("/admin/catalog/order-splitting-config", {
        allowMultiSupplierSplitting,
        splitOnlyAcrossCategories,
      });
      setSuccess("Order splitting configuration updated successfully.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save order splitting configuration");
    } finally {
      setSavingConfig(false);
    }
  }

  // Filter products
  const filteredProducts = initialProducts.filter((p) => {
    if (selectedCategoryFilter !== "ALL" && p.category?.name !== selectedCategoryFilter) {
      return false;
    }
    if (selectedOrderableFilter === "ALLOWED" && !p.isOrderable) {
      return false;
    }
    if (selectedOrderableFilter === "DISABLED" && p.isOrderable) {
      return false;
    }
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchSupplier = p.supplier?.companyName?.toLowerCase().includes(q);
      const matchCategory = p.category?.name?.toLowerCase().includes(q);
      if (!matchName && !matchSupplier && !matchCategory) return false;
    }
    return true;
  });

  const uniqueCategories = Array.from(
    new Set(initialProducts.map((p) => p.category?.name).filter(Boolean))
  ).sort();

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h3 className="text-lg font-bold text-slate-950">Catalog & Order Configuration</h3>
        <p className="mt-1 text-sm text-slate-500">
          Manage master taxonomy, product ordering controls, and multi-supplier order splitting rules.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-4 pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              setName("");
              setCode("");
              setError(null);
              setSuccess(null);
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
        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>
        )}
        {success && (
          <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{success}</p>
        )}

        {/* Master Taxonomy Tabs */}
        {isMasterTab && (
          <div>
            <form onSubmit={handleCreate} className="mb-4 flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {TABS.find((t) => t.key === activeTab)?.label.replace(/s$/, "")} name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`e.g. ${
                    activeTab === "category"
                      ? "Steel"
                      : activeTab === "brand"
                      ? "Ramco"
                      : activeTab === "grade"
                      ? "Fe500"
                      : "Metric Ton"
                  }`}
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

            {isCategory && (
              <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-xs text-blue-900">
                <span className="font-bold">Category Ordering Note:</span> Disabling customer ordering for a category
                prevents buyers from adding or checking out any products within that category across the entire storefront.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    {isUnit && <th className="px-4 py-3 font-semibold">Code</th>}
                    {isCategory && <th className="px-4 py-3 font-semibold">Customer Ordering</th>}
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={isCategory ? 4 : isUnit ? 4 : 3} className="px-4 py-6 text-center text-slate-400">
                        No {activeTab} entries yet.
                      </td>
                    </tr>
                  )}
                  {items.map((item) => {
                    const isOrderable = item.isOrderable !== false;
                    return (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-semibold text-slate-800">{item.name}</td>
                        {isUnit && <td className="px-4 py-3 text-slate-700">{item.code}</td>}
                        {isCategory && (
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-bold ${
                                isOrderable ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                              }`}
                            >
                              {isOrderable ? "ORDERING ALLOWED" : "ORDERING DISABLED"}
                            </span>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${
                              item.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {item.isActive ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        <td className="px-4 py-3 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => void handleToggleActive(item)}
                            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                          >
                            {busyId === item.id ? "Saving..." : item.isActive ? "Deactivate" : "Activate"}
                          </button>
                          {isCategory && (
                            <button
                              type="button"
                              disabled={busyId === `orderable-${item.id}`}
                              onClick={() => void handleToggleCategoryOrderable(item)}
                              className={`rounded-md border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                                isOrderable
                                  ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                                  : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                              }`}
                            >
                              {busyId === `orderable-${item.id}`
                                ? "Saving..."
                                : isOrderable
                                ? "Disable Ordering"
                                : "Enable Ordering"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Products & Ordering Tab */}
        {activeTab === "products" && (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  placeholder="Search products or suppliers..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <select
                  value={selectedCategoryFilter}
                  onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="ALL">All Categories</option>
                  {uniqueCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedOrderableFilter}
                  onChange={(e) => setSelectedOrderableFilter(e.target.value as any)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="ALL">All Ordering States</option>
                  <option value="ALLOWED">Ordering Allowed</option>
                  <option value="DISABLED">Ordering Disabled</option>
                </select>
              </div>
              <div className="text-xs text-slate-500">
                Showing {filteredProducts.length} of {initialProducts.length} products
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Product Name</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Supplier</th>
                    <th className="px-4 py-3 font-semibold">Base Price</th>
                    <th className="px-4 py-3 font-semibold">Customer Ordering</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                        No products match the filter criteria.
                      </td>
                    </tr>
                  )}
                  {filteredProducts.map((product) => {
                    const isOrderable = product.isOrderable !== false;
                    return (
                      <tr key={product.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-semibold text-slate-900">{product.name}</td>
                        <td className="px-4 py-3 text-slate-600">{product.category?.name || "—"}</td>
                        <td className="px-4 py-3 text-slate-600">{product.supplier?.companyName || "—"}</td>
                        <td className="px-4 py-3 text-slate-800">
                          ₹{Number(product.basePrice).toLocaleString("en-IN")} / {product.unit}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${
                              isOrderable ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {isOrderable ? "ORDERING ALLOWED" : "ORDERING DISABLED"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${
                              product.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {product.isActive ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        <td className="px-4 py-3 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyId === `prod-orderable-${product.id}`}
                            onClick={() => void handleToggleProductOrderable(product)}
                            className={`rounded-md border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                              isOrderable
                                ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                                : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            }`}
                          >
                            {busyId === `prod-orderable-${product.id}`
                              ? "Saving..."
                              : isOrderable
                              ? "Disable Ordering"
                              : "Enable Ordering"}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === `prod-active-${product.id}`}
                            onClick={() => void handleToggleProductActive(product)}
                            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                          >
                            {busyId === `prod-active-${product.id}`
                              ? "Saving..."
                              : product.isActive
                              ? "Deactivate"
                              : "Activate"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Order Splitting Settings Tab */}
        {activeTab === "order-splitting" && (
          <div className="max-w-3xl">
            <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="text-base font-bold text-slate-900">Multi-Supplier Order Splitting Rules</h4>
              <p className="mt-1 text-sm text-slate-600">
                Configure how the platform handles buyer carts containing products from multiple suppliers.
              </p>

              <form onSubmit={handleSaveOrderSplittingConfig} className="mt-6 space-y-6">
                {/* Rule 1: Allow Multi-Supplier Splitting */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="text-sm font-bold text-slate-900">
                        Allow Multi-Supplier Order Splitting
                      </span>
                      <p className="mt-1 text-xs text-slate-600">
                        When <span className="font-semibold text-slate-900">Disabled</span> (recommended for Steel/TMT),
                        order splitting is turned off entirely. The system automatically selects the single supplier with
                        the <span className="font-semibold text-slate-900">lowest total basket price</span> that can fulfill
                        all items in the cart. If no single supplier can fulfill all items together, checkout is refused
                        with an actionable notification listing the unfulfillable items.
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        When <span className="font-semibold text-slate-900">Enabled</span>, multi-supplier order splitting
                        is permitted in accordance with the category splitting rule below.
                      </p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={allowMultiSupplierSplitting}
                        onChange={(e) => setAllowMultiSupplierSplitting(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="peer h-6 w-11 rounded-full bg-slate-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-slate-900 peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
                    </label>
                  </div>
                  <div className="mt-3 text-xs font-semibold">
                    Current Status:{" "}
                    <span className={allowMultiSupplierSplitting ? "text-emerald-700" : "text-amber-700"}>
                      {allowMultiSupplierSplitting ? "Splitting Enabled" : "Splitting Disabled (Single Supplier Enforced)"}
                    </span>
                  </div>
                </div>

                {/* Rule 2: Split Only Across Categories */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="text-sm font-bold text-slate-900">
                        Split Only Across Categories
                      </span>
                      <p className="mt-1 text-xs text-slate-600">
                        When <span className="font-semibold text-slate-900">Enabled</span>, orders can only be split if
                        there is <span className="font-semibold text-slate-900">more than one product category</span> in
                        the cart (e.g. Steel + Cement). Within any single category, items will NEVER be split across
                        multiple suppliers; all items in that category must be fulfilled by a single supplier with the
                        lowest basket price.
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        When <span className="font-semibold text-slate-900">Disabled</span>, splitting is allowed even
                        within the same category based on item-level lowest price.
                      </p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={splitOnlyAcrossCategories}
                        onChange={(e) => setSplitOnlyAcrossCategories(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="peer h-6 w-11 rounded-full bg-slate-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-slate-900 peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
                    </label>
                  </div>
                  <div className="mt-3 text-xs font-semibold">
                    Current Status:{" "}
                    <span className={splitOnlyAcrossCategories ? "text-emerald-700" : "text-slate-600"}>
                      {splitOnlyAcrossCategories
                        ? "Split Only Across Categories (Within-Category Splitting Prevented)"
                        : "Unrestricted Splitting"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={savingConfig}
                    className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                  >
                    {savingConfig ? "Saving Configuration..." : "Save Order Splitting Configuration"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
