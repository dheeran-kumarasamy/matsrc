"use client";

// The persistent cart Sheet + inline stepped checkout wizard — the second
// half of the spec 5A single-page overlay ordering architecture. Mounted
// once in app/(builder)/layout.tsx so it can be opened from anywhere
// (nav cart icon, quick-view "Add to Enquiry Basket", product cards) without
// the PLP (or any page) underneath ever unmounting.
//
// Steps: review (line items) -> delivery (geolocation) -> confirm (submit)
// -> success (mocked confirmation + payment-link messaging).

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Trash2, CheckCircle2, ChevronLeft, Minus, Plus, MapPin, LocateFixed } from "lucide-react";



import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { useOverlayStore } from "@/lib/store/overlay-store";
import { useCartStore } from "@/lib/store/cart-store";
import { builderApiPost } from "@/lib/api";
import MapLocationPicker from "./MapLocationPicker";
import SiteSelector from "@/components/orders/SiteSelector";



const STEP_LABELS = [
  { key: "review", label: "Review" },
  { key: "delivery", label: "Delivery" },
  { key: "confirm", label: "Confirm" },
] as const;

// BUG-06 fix: previously the quantity <input>'s `value` was bound directly
// to `item.quantity` and `onChange` only called `updateQuantity` when
// `parseInt` produced a valid number — so clearing the field to type a new
// value produced NaN, the guard skipped the update, and React immediately
// re-rendered the input back to the old quantity (feels "stuck"). This local
// component keeps its own editable string state (synced from the prop when
// it changes from elsewhere, e.g. +/- buttons or a cart refetch), and only
// commits/clamps the value on blur or Enter.
function CartQuantityInput({
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
      className="h-7 w-10 border-x bg-transparent text-center text-xs focus:outline-none disabled:opacity-40"
      style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg)" }}
      aria-label={label}
    />
  );
}

function StepIndicator({ current }: { current: string }) {
  const currentIndex = STEP_LABELS.findIndex((step) => step.key === current);
  return (
    <div className="flex items-center gap-2">
      {STEP_LABELS.map((step, index) => {
        const isActive = index === currentIndex;
        const isDone   = index < currentIndex;
        return (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
              style={
                isActive
                  ? { background: "var(--posh-primary)", color: "var(--posh-primary-fg)" }
                  : isDone
                  ? { background: "rgba(var(--posh-wash-rgb),0.12)", color: "var(--posh-fg)" }
                  : { background: "rgba(var(--posh-wash-rgb),0.06)", color: "var(--posh-fg-muted)" }
              }
            >
              {isDone ? <CheckCircle2 size={14} /> : index + 1}
            </div>
            <span
              className="text-xs font-medium"
              style={{ color: isActive ? "var(--posh-fg)" : "var(--posh-fg-muted)" }}
            >
              {step.label}
            </span>
            {index < STEP_LABELS.length - 1
              ? <div className="mx-1 h-px w-4" style={{ background: "var(--posh-border)" }} />
              : null}
          </div>
        );
      })}
    </div>
  );
}

export default function CartDrawer() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const isCartOpen = useOverlayStore((state) => state.isCartOpen);

  const checkoutStep = useOverlayStore((state) => state.checkoutStep);
  const lastOrderReference = useOverlayStore((state) => state.lastOrderReference);
  const closeCart = useOverlayStore((state) => state.closeCart);
  const setCheckoutStep = useOverlayStore((state) => state.setCheckoutStep);
  const goToNextStep = useOverlayStore((state) => state.goToNextStep);
  const goToPreviousStep = useOverlayStore((state) => state.goToPreviousStep);
  const completeCheckout = useOverlayStore((state) => state.completeCheckout);
  const resetCheckout = useOverlayStore((state) => state.resetCheckout);

  const items = useCartStore((state) => state.items);
  const summary = useCartStore((state) => state.summary);
  const hasLoaded = useCartStore((state) => state.hasLoaded);
  const isMutating = useCartStore((state) => state.isMutating);
  const fetchCart = useCartStore((state) => state.fetchCart);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);


  // REQ-07: delivery date input removed from checkout; pincode replaced with
  // browser-geolocation-based lat/lng capture (+ optional free-text address).
  const [deliveryLat, setDeliveryLat] = useState<number | null>(null);
  const [deliveryLng, setDeliveryLng] = useState<number | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleUseMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError("Geolocation is not supported on this device/browser.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDeliveryLat(position.coords.latitude);
        setDeliveryLng(position.coords.longitude);
        setLocating(false);
      },
      () => {
        setLocationError("Unable to fetch your location. You can still continue without it.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }


  useEffect(() => {
    if (isCartOpen && !hasLoaded) {
      void fetchCart();
    }
  }, [isCartOpen, hasLoaded, fetchCart]);

  const gst = useMemo(() => Math.round(summary.subtotal * 0.18), [summary.subtotal]);
  const total = useMemo(() => summary.subtotal + gst, [summary.subtotal, gst]);

  const supplierGroups = useMemo(() => {
    const groups = new Map<string, { supplierName: string; count: number }>();
    for (const item of items) {
      const existing = groups.get(item.supplierId) ?? { supplierName: item.supplierName, count: 0 };
      existing.count += 1;
      groups.set(item.supplierId, existing);
    }
    return Array.from(groups.values());
  }, [items]);

  function handleOpenChange(open: boolean) {
    if (!open) {
      closeCart();
      // Give the close animation a beat before resetting the wizard step,
      // so re-opening the drawer doesn't visibly "jump" mid-close.
      window.setTimeout(() => resetCheckout(), 200);
    }
  }

  async function handleSubmitEnquiry() {
    if (items.length === 0) return;

    // Ordering is only allowed for signed-in users — redirect to login and
    // return to this same flow once authenticated.
    if (sessionStatus !== "authenticated") {
      closeCart();
      router.push(`/auth/login?callbackUrl=${encodeURIComponent("/checkout")}`);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {

      const response = await builderApiPost<{ orders: Array<{ id: string }> }>("/orders/checkout", {
        deliveryLat: deliveryLat ?? undefined,
        deliveryLng: deliveryLng ?? undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        siteId: siteId || undefined,
      });

      const reference = response.orders?.[0]?.id ?? "submitted";
      completeCheckout(reference);
      void fetchCart();
    } catch {
      setSubmitError("Unable to submit enquiry right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleViewOrders() {
    closeCart();
    resetCheckout();
    router.push("/orders");
  }

  return (
    <Sheet open={isCartOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        className="flex flex-col border-l p-0"
        style={{ borderColor: "var(--posh-border)", background: "var(--posh-bg-card)", color: "var(--posh-fg)" }}
      >
        <SheetHeader style={{ borderColor: "var(--posh-border)" }}>
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle style={{ color: "var(--posh-fg)" }}>
                {checkoutStep === "success" ? "Enquiry submitted" : "Your enquiry basket"}
              </SheetTitle>
              <SheetDescription style={{ color: "var(--posh-fg-muted)" }}>
                {checkoutStep === "success"
                  ? "Suppliers will confirm and unlock payment links."
                  : "No payment is taken here — this submits a supplier enquiry."}
              </SheetDescription>
            </div>
          </div>
          {checkoutStep !== "success" ? (
            <div className="pt-2">
              <StepIndicator current={checkoutStep} />
            </div>
          ) : null}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-5">
          {checkoutStep === "review" ? (
            <div className="space-y-3">
              {items.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: "var(--posh-border)" }}>
                  <p className="text-sm" style={{ color: "var(--posh-fg-muted)" }}>Your enquiry basket is empty.</p>
                  <Link href="/products" onClick={() => closeCart()}
                    className="mt-3 inline-block text-sm transition-opacity hover:opacity-70 underline underline-offset-4"
                    style={{ color: "var(--posh-fg)" }}>
                    Browse materials →
                  </Link>
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="flex gap-3 rounded-2xl border p-3" style={{ borderColor: "var(--posh-border)", background: "rgba(var(--posh-wash-rgb),0.03)" }}>
                    <div className="h-14 w-14 shrink-0 rounded-xl" style={{ background: "rgba(var(--posh-wash-rgb),0.08)" }} />
                    <div className="flex-1">
                      <p className="text-sm font-medium" style={{ color: "var(--posh-fg)" }}>{item.name}</p>
                      <p className="text-xs" style={{ color: "var(--posh-fg-muted)" }}>{item.supplierName}</p>
                      <p className="text-xs" style={{ color: "var(--posh-fg-muted)" }}>₹{item.unitPrice.toLocaleString("en-IN")}/unit</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex items-center rounded-lg border" style={{ borderColor: "var(--posh-border)" }}>
                          <button type="button"
                            disabled={isMutating || item.quantity <= 1}
                            onClick={() => void updateQuantity(item.productId, item.id, item.quantity - 1)}
                            aria-label={`Decrease quantity for ${item.name}`}
                            className="flex h-7 w-7 items-center justify-center transition disabled:opacity-40"
                            style={{ color: "var(--posh-fg-muted)" }}>
                            <Minus size={12} />
                          </button>
                          <CartQuantityInput quantity={item.quantity} disabled={isMutating}
                            label={`Quantity for ${item.name}`}
                            onCommit={(nextQuantity) => void updateQuantity(item.productId, item.id, nextQuantity)} />
                          <button type="button" disabled={isMutating}
                            onClick={() => void updateQuantity(item.productId, item.id, item.quantity + 1)}
                            aria-label={`Increase quantity for ${item.name}`}
                            className="flex h-7 w-7 items-center justify-center transition disabled:opacity-40"
                            style={{ color: "var(--posh-fg-muted)" }}>
                            <Plus size={12} />
                          </button>
                        </div>
                        <span className="text-xs" style={{ color: "var(--posh-fg-muted)" }}>{item.unit}</span>
                      </div>
                      <p className="posh-heading mt-1 text-base" style={{ color: "var(--posh-fg)" }}>
                        ₹{item.lineTotal.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <button onClick={() => void removeItem(item.productId, item.id)} disabled={isMutating}
                      className="self-start transition hover:text-red-500 disabled:opacity-40"
                      style={{ color: "var(--posh-fg-muted)" }}
                      aria-label={`Remove ${item.name}`}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}

              {supplierGroups.length > 1 ? (
                <p className="rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(var(--posh-wash-rgb),0.06)", color: "var(--posh-fg-muted)" }}>
                  Items span {supplierGroups.length} suppliers — these will be submitted as separate enquiries.
                </p>
              ) : null}
            </div>
          ) : null}

          {checkoutStep === "delivery" ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--posh-fg-muted)" }}>Delivery location (optional)</label>
                <button type="button" onClick={handleUseMyLocation} disabled={locating}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition disabled:opacity-50"
                  style={{ borderColor: "rgba(var(--posh-wash-rgb),0.15)", color: "var(--posh-fg-muted)", background: "rgba(var(--posh-wash-rgb),0.05)" }}>
                  <LocateFixed size={14} />
                  {locating ? "Fetching location..." : "Use my current location"}
                </button>
                {deliveryLat !== null && deliveryLng !== null ? (
                  <p className="mt-2 flex items-center gap-1 text-xs" style={{ color: "#4ade80" }}>
                    <MapPin size={12} />
                    Location captured ({deliveryLat.toFixed(4)}, {deliveryLng.toFixed(4)})
                  </p>
                ) : null}
                {locationError ? <p className="mt-2 text-xs font-bold" style={{ color: "#f87171" }}>{locationError}</p> : null}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--posh-fg-muted)" }}>
                  Select on map (optional)
                </label>
                <MapLocationPicker
                  lat={deliveryLat}
                  lng={deliveryLng}
                  onLocationSelect={(lat, lng) => {
                    setDeliveryLat(lat);
                    setDeliveryLng(lng);
                    setLocationError(null);
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em]" style={{ color: "var(--posh-fg-muted)" }}>Delivery address (optional)</label>

                <input
                  placeholder="e.g. Site name, street, area"
                  value={deliveryAddress}
                  onChange={(event) => setDeliveryAddress(event.target.value)}
                  className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: "rgba(var(--posh-wash-rgb),0.15)", background: "rgba(var(--posh-wash-rgb),0.05)", color: "var(--posh-fg)" }}
                />
              </div>
              <SiteSelector value={siteId} onChange={setSiteId} />
              <p className="text-xs" style={{ color: "var(--posh-fg-muted)" }}>
                This is used to route your enquiry to nearby suppliers and estimate freight — it does not commit you to a payment.
              </p>
            </div>
          ) : null}


          {checkoutStep === "confirm" ? (
            <div className="space-y-4">
              <div className="rounded-2xl border p-4" style={{ borderColor: "rgba(var(--posh-wash-rgb),0.12)", background: "rgba(36,31,22,0.50)" }}>
                <h3 className="text-sm font-semibold" style={{ color: "var(--posh-fg)" }}>Order summary</h3>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between" style={{ color: "var(--posh-fg-muted)" }}>
                    <span>Subtotal</span><span>₹{summary.subtotal.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between" style={{ color: "var(--posh-fg-muted)" }}>
                    <span>GST (18%)</span><span>₹{gst.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2" style={{ borderColor: "rgba(var(--posh-wash-rgb),0.12)" }}>
                    <span className="font-bold" style={{ color: "var(--posh-fg)" }}>Estimated total</span>
                    <span className="posh-heading text-lg" style={{ color: "var(--posh-primary)" }}>₹{total.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>
              {deliveryLat !== null && deliveryLng !== null ? (
                <p className="text-xs" style={{ color: "var(--posh-fg-muted)" }}>
                  Delivery location: <span className="font-medium" style={{ color: "var(--posh-fg)" }}>{deliveryLat.toFixed(4)}, {deliveryLng.toFixed(4)}</span>
                  {deliveryAddress ? ` · ${deliveryAddress}` : ""}
                </p>
              ) : null}
              <p className="text-xs" style={{ color: "var(--posh-fg-muted)" }}>
                Submitting will send a separate enquiry to each supplier represented in your basket. No payment is collected now.
              </p>
              {submitError ? <p className="text-xs font-bold" style={{ color: "#f87171" }}>{submitError}</p> : null}
            </div>
          ) : null}

          {checkoutStep === "success" ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(74,222,128,0.15)", color: "#4ade80" }}>
                <CheckCircle2 size={28} />
              </div>
              <p className="text-sm font-semibold" style={{ color: "var(--posh-fg)" }}>Enquiry {lastOrderReference} submitted</p>
              <p className="max-w-xs text-xs" style={{ color: "var(--posh-fg-muted)" }}>
                Suppliers have been notified. Once a supplier confirms, a payment link will appear on the order detail page — no payment is required yet.
              </p>
            </div>
          ) : null}
        </div>

        <SheetFooter className="space-y-3" style={{ borderColor: "rgba(var(--posh-wash-rgb),0.10)" }}>
          {checkoutStep === "review" ? (
            <button onClick={() => setCheckoutStep("delivery")} disabled={items.length === 0}
              className="posh-btn-solid w-full rounded-2xl py-2.5 text-sm font-semibold disabled:opacity-50">
              Continue to delivery
            </button>
          ) : null}

          {checkoutStep === "delivery" ? (
            <div className="flex gap-2">
              <button onClick={goToPreviousStep}
                className="flex items-center justify-center gap-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition"
                style={{ borderColor: "rgba(var(--posh-wash-rgb),0.15)", color: "var(--posh-fg-muted)", background: "rgba(var(--posh-wash-rgb),0.05)" }}>
                <ChevronLeft size={14} /> Back
              </button>
              <button onClick={goToNextStep}
                className="posh-btn-solid flex-1 rounded-2xl py-2.5 text-sm font-semibold">
                Continue to confirm
              </button>
            </div>
          ) : null}

          {checkoutStep === "confirm" ? (
            <div className="flex gap-2">
              <button onClick={goToPreviousStep} disabled={submitting}
                className="flex items-center justify-center gap-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50"
                style={{ borderColor: "rgba(var(--posh-wash-rgb),0.15)", color: "var(--posh-fg-muted)", background: "rgba(var(--posh-wash-rgb),0.05)" }}>
                <ChevronLeft size={14} /> Back
              </button>
              <button onClick={() => void handleSubmitEnquiry()} disabled={submitting || items.length === 0}
                className="posh-btn-solid flex-1 rounded-2xl py-2.5 text-sm font-semibold disabled:opacity-50">
                {submitting ? "Submitting..." : "Submit Enquiry"}
              </button>
            </div>
          ) : null}

          {checkoutStep === "success" ? (
            <button onClick={handleViewOrders}
              className="posh-btn-solid w-full rounded-2xl py-2.5 text-sm font-semibold">
              View My Orders
            </button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
