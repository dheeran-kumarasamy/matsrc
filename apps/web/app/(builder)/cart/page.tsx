"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Minus, Plus, Trash2 } from "lucide-react";
import { builderApiDelete, builderApiGet, builderApiPost } from "@/lib/api";

// BUG-06 fix: this input keeps its own local editable string state, synced
// from the `quantity` prop via useEffect (so +/- button clicks and cart
// refetches still update the displayed value), and only commits the parsed
// value (on blur or Enter) instead of on every keystroke. Previously the
// input's `value` was bound directly to `item.quantity` and `onChange` used a
// `parseInt`/`isNaN` guard that skipped the update whenever the field was
// cleared to type a new value, making the input appear "stuck".
function CartPageQuantityInput({
  quantity,
  disabled,
  label,
  onCommit,
}: {
  quantity: number;
  disabled: boolean;
  label: string;
  onCommit: (nextQuantity: number) => void;
}) {
  const [value, setValue] = useState(String(quantity));

  useEffect(() => {
    setValue(String(quantity));
  }, [quantity]);

  function commit(raw: string) {
    const parsed = parseInt(raw, 10);
    const safe = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    setValue(String(safe));
    if (safe !== quantity) {
      onCommit(safe);
    }
  }

  return (
    <input
      type="number"
      min={1}
      step={1}
      inputMode="numeric"
      value={value}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          commit((event.target as HTMLInputElement).value);
        }
      }}
      className="h-8 w-12 border-x text-center text-sm font-bold focus:outline-none disabled:opacity-40"
      style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg)" }}
      aria-label={label}
    />
  );
}



type CartResponse = {
  items: Array<{
    id: string;
    productId: string;
    name: string;
    unit: string;
    supplierId: string;
    supplierName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  summary: {
    itemCount: number;
    subtotal: number;
    subtotalLabel: string;
  };
};

// UF-02 Step 8–9, UF-03 Step 1 — FR-09
export default function CartPage() {
  const router = useRouter();
  const [data, setData] = useState<CartResponse>({ items: [], summary: { itemCount: 0, subtotal: 0, subtotalLabel: "INR 0" } });
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);


  useEffect(() => {
    let active = true;

    async function loadCart() {
      try {
        const payload = await builderApiGet<CartResponse>("/cart");
        if (!active) return;
        setData(payload);
      } catch {
        if (!active) return;
        setData({ items: [], summary: { itemCount: 0, subtotal: 0, subtotalLabel: "INR 0" } });
      }
    }

    void loadCart();
    return () => {
      active = false;
    };
  }, []);

  const gst = useMemo(() => Math.round(data.summary.subtotal * 0.18), [data.summary.subtotal]);
  const total = useMemo(() => data.summary.subtotal + gst, [data.summary.subtotal, gst]);

  async function handleRemove(productId: string, id: string) {
    setLoadingId(id);
    try {
      await builderApiDelete(`/cart/items/${productId}`);
      setData((prev) => {
        const items = prev.items.filter((item) => item.id !== id);
        const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
        return {
          items,
          summary: {
            itemCount: items.length,
            subtotal,
            subtotalLabel: `INR ${subtotal.toLocaleString("en-IN")}`,
          },
        };
      });
    } finally {
      setLoadingId(null);
    }
  }

  // REQ-01: editable cart quantity. Enforces min 1 / integer bounds, then
  // persists via the existing cart upsert endpoint (CartService.upsert),
  // and re-fetches the cart so unitPrice/lineTotal reflect any tiered
  // pricing recomputed server-side.
  async function handleUpdateQuantity(productId: string, id: string, nextQuantity: number) {
    const safeQuantity = Math.max(1, Math.floor(nextQuantity) || 1);
    const previous = data;
    setUpdatingId(id);
    setData((prev) => {
      const items = prev.items.map((item) =>
        item.id === id ? { ...item, quantity: safeQuantity, lineTotal: item.unitPrice * safeQuantity } : item
      );
      const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
      return {
        items,
        summary: { itemCount: items.length, subtotal, subtotalLabel: `INR ${subtotal.toLocaleString("en-IN")}` },
      };
    });
    try {
      await builderApiPost("/cart/items", { productId, quantity: safeQuantity });
      const payload = await builderApiGet<CartResponse>("/cart");
      setData(payload);
    } catch {
      setData(previous);
    } finally {
      setUpdatingId(null);
    }
  }


  async function handleSubmitEnquiry() {
    if (data.items.length === 0) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      await builderApiPost("/orders/checkout", {});
      router.push("/orders");
      router.refresh();
    } catch {
      setSubmitError("Unable to submit enquiry right now.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="posh-body space-y-5">
      <header>
        <p className="posh-eyebrow">Procurement desk</p>
        <h1 className="posh-page-title mt-2">My Cart</h1>
        <p className="posh-subtitle mt-2 max-w-2xl">
          Review your materials, then submit a single enquiry to every supplier in one step.
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Cart items */}
        <div className="flex-1 space-y-3">
          {data.items.length === 0 ? (
            <div className="posh-card p-10 text-center">
              <p className="posh-card-title">Your cart is empty</p>
              <Link href="/products" className="posh-link mt-4 inline-block">
                Browse materials →
              </Link>
            </div>
          ) : (
            data.items.map((item) => (
              <div key={item.id} className="posh-card flex gap-4 p-5">
                <div className="h-16 w-16 shrink-0 rounded-xl border" style={{ borderColor: "var(--posh-border)", background: "rgba(240,232,216,0.06)" }} />
                <div className="flex-1">
                  <p className="text-base font-bold tracking-tight" style={{ color: "var(--posh-fg)" }}>{item.name}</p>
                  <p className="posh-label mt-1">Supplier: {item.supplierName}</p>
                  <p className="posh-label mt-0.5">Unit price: INR {item.unitPrice.toLocaleString("en-IN")}</p>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex items-center rounded-full border" style={{ borderColor: "var(--posh-border)" }}>
                      <button
                        type="button"
                        disabled={updatingId === item.id || item.quantity <= 1}
                        onClick={() => void handleUpdateQuantity(item.productId, item.id, item.quantity - 1)}
                        aria-label={`Decrease quantity for ${item.name}`}
                        className="flex h-8 w-8 items-center justify-center transition disabled:opacity-40"
                        style={{ color: "var(--posh-fg-muted)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--posh-fg)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--posh-fg-muted)")}
                      >
                        <Minus size={14} />
                      </button>
                      <CartPageQuantityInput
                        quantity={item.quantity}
                        disabled={updatingId === item.id}
                        label={`Quantity for ${item.name}`}
                        onCommit={(nextQuantity) => void handleUpdateQuantity(item.productId, item.id, nextQuantity)}
                      />

                      <button
                        type="button"
                        disabled={updatingId === item.id}
                        onClick={() => void handleUpdateQuantity(item.productId, item.id, item.quantity + 1)}
                        aria-label={`Increase quantity for ${item.name}`}
                        className="flex h-8 w-8 items-center justify-center transition disabled:opacity-40"
                        style={{ color: "var(--posh-fg-muted)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--posh-fg)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--posh-fg-muted)")}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <span className="posh-label">{item.unit}</span>
                    <span className="text-sm font-bold" style={{ color: "var(--posh-fg)" }}>INR {item.lineTotal.toLocaleString("en-IN")}</span>
                  </div>

                </div>
                <button
                  disabled={loadingId === item.id}
                  onClick={() => void handleRemove(item.productId, item.id)}
                  className="transition-colors disabled:opacity-40"
                  style={{ color: "var(--posh-fg-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--posh-fg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--posh-fg-muted)")}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Order summary */}
        <div className="w-full shrink-0 lg:w-80">
          <div className="posh-card sticky top-20 space-y-4 p-6">
            <h2 className="posh-card-title">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between font-semibold" style={{ color: "var(--posh-fg-muted)" }}>
                <span>Subtotal</span><span>INR {data.summary.subtotal.toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between font-semibold" style={{ color: "var(--posh-fg-muted)" }}>
                <span>GST (18%)</span><span>INR {gst.toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between font-semibold" style={{ color: "var(--posh-fg-muted)" }}>
                <span>Freight</span><span>—</span>
              </div>
              <div className="flex justify-between border-t pt-3 text-base font-bold" style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg)" }}>
                <span>Total</span><span>INR {total.toLocaleString("en-IN")}</span>
              </div>
            </div>
            <button
              onClick={() => void handleSubmitEnquiry()}
              disabled={data.items.length === 0 || submitting}
              className="posh-btn block w-full text-center"
            >
              {submitting ? "Submitting..." : "Submit Enquiry"}
            </button>
            {data.items.length === 0 ? (
              <span
                aria-disabled="true"
                className="block w-full cursor-not-allowed text-center text-[10px] font-bold uppercase tracking-[0.14em]"
                style={{ color: "var(--posh-fg-muted)", opacity: 0.5 }}
              >
                Review on checkout page
              </span>
            ) : (
              <Link href="/checkout" className="posh-link block w-full text-center">
                Review on checkout page
              </Link>
            )}

            {submitError ? <p className="text-xs font-bold" style={{ color: "#f87171" }}>{submitError}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
