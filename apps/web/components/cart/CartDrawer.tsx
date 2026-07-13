"use client";

// The persistent cart Sheet + inline stepped checkout wizard — the second
// half of the spec 5A single-page overlay ordering architecture. Mounted
// once in app/(builder)/layout.tsx so it can be opened from anywhere
// (nav cart icon, quick-view "Add to Enquiry Basket", product cards) without
// the PLP (or any page) underneath ever unmounting.
//
// Steps: review (line items) -> delivery (date/pincode) -> confirm (submit)
// -> success (mocked confirmation + payment-link messaging).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, CheckCircle2, ChevronLeft } from "lucide-react";
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

const STEP_LABELS = [
  { key: "review", label: "Review" },
  { key: "delivery", label: "Delivery" },
  { key: "confirm", label: "Confirm" },
] as const;

function StepIndicator({ current }: { current: string }) {
  const currentIndex = STEP_LABELS.findIndex((step) => step.key === current);
  return (
    <div className="flex items-center gap-2">
      {STEP_LABELS.map((step, index) => {
        const isActive = index === currentIndex;
        const isDone = index < currentIndex;
        return (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                isActive
                  ? "bg-blue-700 text-white"
                  : isDone
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-400"
              }`}
            >
              {isDone ? <CheckCircle2 size={14} /> : index + 1}
            </div>
            <span className={`text-xs font-medium ${isActive ? "text-slate-900" : "text-slate-400"}`}>{step.label}</span>
            {index < STEP_LABELS.length - 1 ? <div className="mx-1 h-px w-4 bg-slate-200" /> : null}
          </div>
        );
      })}
    </div>
  );
}

export default function CartDrawer() {
  const router = useRouter();
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

  const [deliveryDate, setDeliveryDate] = useState("");
  const [pincode, setPincode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await builderApiPost<{ orders: Array<{ id: string }> }>("/orders/checkout", {
        deliveryDate: deliveryDate || undefined,
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
      <SheetContent className="flex flex-col p-0">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>
                {checkoutStep === "success" ? "Enquiry submitted" : "Your enquiry basket"}
              </SheetTitle>
              <SheetDescription>
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
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
                  <p className="text-sm text-slate-400">Your enquiry basket is empty.</p>
                  <Link
                    href="/products"
                    onClick={() => closeCart()}
                    className="mt-3 inline-block text-sm text-blue-700 hover:underline"
                  >
                    Browse materials →
                  </Link>
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="flex gap-3 rounded-xl border border-slate-100 p-3">
                    <div className="h-14 w-14 shrink-0 rounded-lg bg-slate-100" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-800">{item.name}</p>
                      <p className="text-xs text-slate-400">{item.supplierName}</p>
                      <p className="text-xs text-slate-400">
                        Qty: {item.quantity} {item.unit} · ₹{item.unitPrice.toLocaleString("en-IN")}/unit
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        ₹{item.lineTotal.toLocaleString("en-IN")}
                      </p>
                    </div>
                    <button
                      onClick={() => void removeItem(item.productId, item.id)}
                      disabled={isMutating}
                      className="self-start text-slate-300 transition hover:text-red-500 disabled:opacity-40"
                      aria-label={`Remove ${item.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}

              {supplierGroups.length > 1 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Items span {supplierGroups.length} suppliers — these will be submitted as separate enquiries.
                </p>
              ) : null}
            </div>
          ) : null}

          {checkoutStep === "delivery" ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Preferred delivery date (optional)</label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(event) => setDeliveryDate(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Delivery pincode (optional)</label>
                <input
                  placeholder="e.g. 560001"
                  maxLength={6}
                  value={pincode}
                  onChange={(event) => setPincode(event.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <p className="text-xs text-slate-400">
                This is used to route your enquiry to nearby suppliers and estimate freight — it does not commit you to
                a payment.
              </p>
            </div>
          ) : null}

          {checkoutStep === "confirm" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <h3 className="text-sm font-semibold text-slate-800">Order summary</h3>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between text-slate-500">
                    <span>Subtotal</span>
                    <span>₹{summary.subtotal.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>GST (18%)</span>
                    <span>₹{gst.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-800">
                    <span>Estimated total</span>
                    <span>₹{total.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>
              {deliveryDate ? (
                <p className="text-xs text-slate-500">
                  Preferred delivery: <span className="font-medium text-slate-700">{deliveryDate}</span>
                  {pincode ? ` · Pincode ${pincode}` : ""}
                </p>
              ) : null}
              <p className="text-xs text-slate-400">
                Submitting will send a separate enquiry to each supplier represented in your basket. No payment is
                collected now.
              </p>
              {submitError ? <p className="text-xs text-red-600">{submitError}</p> : null}
            </div>
          ) : null}

          {checkoutStep === "success" ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 size={28} />
              </div>
              <p className="text-sm font-semibold text-slate-800">Enquiry {lastOrderReference} submitted</p>
              <p className="max-w-xs text-xs text-slate-500">
                {/* TODO(launch): replace this mocked payment-link messaging with real supplier confirmation + Razorpay/Stripe payment link generation */}
                Suppliers have been notified. Once a supplier confirms, a payment link will appear on the order detail
                page — no payment is required yet.
              </p>
            </div>
          ) : null}
        </div>

        <SheetFooter className="space-y-3">
          {checkoutStep === "review" ? (
            <button
              onClick={() => setCheckoutStep("delivery")}
              disabled={items.length === 0}
              className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
            >
              Continue to delivery
            </button>
          ) : null}

          {checkoutStep === "delivery" ? (
            <div className="flex gap-2">
              <button
                onClick={goToPreviousStep}
                className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                <ChevronLeft size={14} /> Back
              </button>
              <button
                onClick={goToNextStep}
                className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800"
              >
                Continue to confirm
              </button>
            </div>
          ) : null}

          {checkoutStep === "confirm" ? (
            <div className="flex gap-2">
              <button
                onClick={goToPreviousStep}
                disabled={submitting}
                className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <ChevronLeft size={14} /> Back
              </button>
              <button
                onClick={() => void handleSubmitEnquiry()}
                disabled={submitting || items.length === 0}
                className="flex-1 rounded-lg bg-emerald-700 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                {submitting ? "Submitting..." : "Submit Enquiry"}
              </button>
            </div>
          ) : null}

          {checkoutStep === "success" ? (
            <button
              onClick={handleViewOrders}
              className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800"
            >
              View My Orders
            </button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
