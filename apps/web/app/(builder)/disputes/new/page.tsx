"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { builderApiGet, builderApiPost } from "@/lib/api";

type OrderOption = {
  id: string;
  status: string;
  total: number;
  totalLabel: string;
  createdAt: string;
  supplierName: string;
};

// UF-10 Step 3: Raise dispute ticket — FR-16
//
// BUG-02 fix: the Order field used to be a plain read-only text input that
// only ever showed whatever was in the `?orderId=` query param — builders
// navigating here directly (not from an order's detail page) had no way to
// pick an order at all, and there was no validation that the typed/prefilled
// orderId even belonged to them. It's now a searchable dropdown populated
// from the builder's own orders (GET /api/builder/orders, already scoped to
// `userId: user.id` server-side), preselected from `?orderId=` when present,
// and submission is disabled entirely if the builder has no orders.
function NewDisputeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedOrderId = searchParams.get("orderId") ?? "";

  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");

  const [orderQuery, setOrderQuery] = useState("");
  const [orderId, setOrderId] = useState(preselectedOrderId);
  const [issueType, setIssueType] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const issueTypes = ["Wrong quantity delivered", "Damaged goods", "Quality mismatch", "Late delivery", "Missing items", "Other"];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await builderApiGet<OrderOption[]>("/orders");
        if (cancelled) return;
        setOrders(data);
        // Only honour the preselected orderId if it's actually one of this
        // builder's own orders — otherwise fall back to no selection rather
        // than silently submitting against an order that isn't theirs.
        if (preselectedOrderId && data.some((o) => o.id === preselectedOrderId)) {
          setOrderId(preselectedOrderId);
        } else if (preselectedOrderId) {
          setOrderId("");
        }
      } catch (err: any) {
        if (!cancelled) setOrdersError(err.message ?? "Failed to load your orders");
      } finally {
        if (!cancelled) setOrdersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        o.supplierName.toLowerCase().includes(q) ||
        o.status.toLowerCase().includes(q)
    );
  }, [orders, orderQuery]);

  const hasNoOrders = !ordersLoading && !ordersError && orders.length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!orderId) {
      setError("Please select an order to raise a dispute for.");
      return;
    }

    setLoading(true);
    try {
      await builderApiPost<{ id: string }>("/disputes", {
        orderId,
        issueType,
        description,
      });
      router.push("/disputes");
    } catch (err: any) {
      setError(err.message ?? "Failed to raise dispute");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="posh-body mx-auto max-w-xl space-y-5">
      <header>
        <p className="posh-eyebrow">Resolution desk</p>
        <h1 className="posh-page-title mt-2">Raise a Dispute</h1>
      </header>
      <div className="rounded-xl border border-[color:var(--posh-border)] bg-[rgba(240,232,216,0.03)] p-4 text-xs font-medium text-[color:var(--posh-fg-muted)]">
        Disputes are reviewed within <strong className="font-bold text-[color:var(--posh-fg)]">72 hours</strong>. Unresolved tickets escalate automatically to senior admin. (FR-16)
      </div>

      {hasNoOrders && (
        <div className="rounded-xl border border-[color:var(--posh-border)] bg-[rgba(240,232,216,0.03)] p-4 text-xs font-medium text-[color:var(--posh-fg-muted)]">
          You don&apos;t have any orders yet, so there&apos;s nothing to raise a dispute against. Place an order first.
        </div>
      )}
      {ordersError && (
        <div className="rounded-xl border border-[color:var(--posh-primary)] bg-[color:var(--posh-bg-card)] p-4 text-xs font-bold text-[color:var(--posh-fg)]">{ordersError}</div>
      )}

      <form onSubmit={handleSubmit} className="posh-card space-y-4 p-6">
        <div>
          <label className="posh-label mb-1.5 block">Order</label>
          <input
            type="text"
            value={orderQuery}
            onChange={(e) => setOrderQuery(e.target.value)}
            placeholder="Search by order ID or supplier..."
            disabled={ordersLoading || hasNoOrders}
            className="posh-input mb-2 disabled:opacity-60/[0.04] disabled:text-[color:var(--posh-fg-muted)]"
          />
          <select
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            required
            disabled={ordersLoading || hasNoOrders}
            className="posh-input disabled:opacity-60/[0.04] disabled:text-[color:var(--posh-fg-muted)]"
          >
            <option value="">
              {ordersLoading ? "Loading your orders..." : "Select an order"}
            </option>
            {filteredOrders.map((o) => (
              <option key={o.id} value={o.id}>
                #{o.id.slice(0, 8)} · {o.supplierName} · {o.totalLabel} · {new Date(o.createdAt).toLocaleDateString("en-IN")}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="posh-label mb-1.5 block">Issue Type</label>
          <select value={issueType} onChange={(e) => setIssueType(e.target.value)} required className="posh-input">
            <option value="">Select issue type</option>
            {issueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className="posh-label mb-1.5 block">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            rows={4}
            placeholder="Describe the issue in detail..."
            className="posh-input resize-none"
          />
        </div>

        <div>
          <label className="posh-label mb-1.5 block">Photo Evidence</label>
          <div className="rounded-xl border-2 border-dashed border-[color:var(--posh-border)] p-4 text-center">
            <input
              type="file"
              accept="image/*"
              multiple
              id="evidence"
              className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <label htmlFor="evidence" className="posh-link cursor-pointer">
              {files.length > 0 ? `${files.length} file(s) selected` : "Upload photos (JPG / PNG)"}
            </label>
          </div>
        </div>

        {error && <p className="text-xs font-bold text-[color:var(--posh-fg)]">{error}</p>}

        <button
          type="submit"
          disabled={loading || hasNoOrders || ordersLoading}
          className="posh-btn w-full"
        >
          {loading ? "Submitting..." : "Submit Dispute"}
        </button>
      </form>
    </div>
  );
}

export default function NewDisputePage() {
  return (
    <Suspense fallback={<div className="posh-card posh-muted p-8 text-center">Loading...</div>}>
      <NewDisputeForm />
    </Suspense>
  );
}
