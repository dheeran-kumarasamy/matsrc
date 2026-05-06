"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MfaVerification from "@/components/checkout/MfaVerification";
import { builderApiGet, builderApiPost } from "@/lib/api";

type PaymentMethod = "UPI" | "CARD" | "NET_BANKING" | "COD" | "CREDIT" | "BANK_TRANSFER";

type CartResponse = {
  items: Array<{
    id: string;
    productId: string;
    name: string;
    unit: string;
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

type CheckoutResult = {
  id: string;
  status: string;
  total: number;
  itemCount: number;
};

// UF-03: Checkout & Payment — FR-09, FR-10, FR-11, FR-12
export default function CheckoutPage() {
  const router = useRouter();
  const [step, setStep] = useState<"review" | "mfa">("review");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("UPI");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartResponse>({ items: [], summary: { itemCount: 0, subtotal: 0, subtotalLabel: "INR 0" } });

  useEffect(() => {
    let active = true;

    async function loadCart() {
      try {
        const payload = await builderApiGet<CartResponse>("/builder/cart");
        if (!active) return;
        setCart(payload);
      } catch {
        if (!active) return;
        setCart({ items: [], summary: { itemCount: 0, subtotal: 0, subtotalLabel: "INR 0" } });
      }
    }

    void loadCart();
    return () => {
      active = false;
    };
  }, []);

  const gst = useMemo(() => Math.round(cart.summary.subtotal * 0.18), [cart.summary.subtotal]);
  const total = useMemo(() => cart.summary.subtotal + gst, [cart.summary.subtotal, gst]);

  const paymentOptions: { value: PaymentMethod; label: string; desc: string }[] = [
    { value: "UPI", label: "UPI", desc: "Pay via any UPI app" },
    { value: "CARD", label: "Debit / Credit Card", desc: "Visa, Mastercard, RuPay" },
    { value: "NET_BANKING", label: "Net Banking", desc: "All major banks" },
    { value: "COD", label: "Cash on Delivery", desc: "Pay when goods arrive" },
    { value: "CREDIT", label: "Credit / BNPL", desc: "EMI, 30/60/90-day pay later" },
    { value: "BANK_TRANSFER", label: "NEFT / RTGS", desc: "Upload UTR as proof" },
  ];

  function handlePlaceOrder() {
    if (!cart.items.length) {
      setError("Your cart is empty.");
      return;
    }

    setError(null);
    setStep("mfa");
  }

  async function handleVerified() {
    setLoading(true);
    setError(null);
    try {
      const order = await builderApiPost<CheckoutResult>("/builder/orders/checkout", {
        paymentMethod,
        deliveryDate: deliveryDate || undefined,
      });
      router.push(`/orders/${order.id}`);
    } catch {
      setError("Unable to place order right now.");
      setStep("review");
    } finally {
      setLoading(false);
    }
  }

  if (step === "mfa") {
    return <MfaVerification onVerified={handleVerified} />;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-slate-900">Checkout</h1>

      {/* Step 1: Review cart */}
      <div className="panel p-5">
        <h2 className="font-semibold text-slate-800 mb-3">1. Review Cart</h2>
        <p className="text-sm text-slate-400">Stock re-validated against live supplier inventory.</p>
        <div className="mt-3 border border-slate-100 rounded-lg divide-y divide-slate-100">
          {cart.items.length === 0 ? (
            <div className="py-4 text-center text-slate-300 text-sm">No cart items found.</div>
          ) : (
            cart.items.map((item) => (
              <div key={item.id} className="px-3 py-2 flex items-center justify-between text-sm">
                <span className="text-slate-700">{item.name} ({item.quantity} {item.unit})</span>
                <span className="font-semibold text-slate-900">INR {item.lineTotal.toLocaleString("en-IN")}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Step 2: Delivery dates — FR-10 */}
      <div className="panel p-5">
        <h2 className="font-semibold text-slate-800 mb-3">2. Preferred Delivery Dates</h2>
        <p className="text-xs text-slate-400 mb-3">Set a preferred delivery date per supplier.</p>
        <div className="border border-slate-100 rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm text-slate-700">Raipur Steel Co.</span>
          <input
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className="text-xs border border-slate-200 rounded px-2 py-1"
          />
        </div>
      </div>

      {/* Step 3: Payment method — FR-11, FR-12 */}
      <div className="panel p-5">
        <h2 className="font-semibold text-slate-800 mb-3">3. Payment Method</h2>
        <div className="space-y-2">
          {paymentOptions.map(({ value, label, desc }) => (
            <label key={value} className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${paymentMethod === value ? "border-blue-700 bg-blue-50" : "border-slate-100 hover:border-slate-200"}`}>
              <input
                type="radio"
                name="payment"
                value={value}
                checked={paymentMethod === value}
                onChange={() => setPaymentMethod(value)}
                className="accent-blue-700"
              />
              <div>
                <div className="text-sm font-medium text-slate-800">{label}</div>
                <div className="text-xs text-slate-400">{desc}</div>
              </div>
            </label>
          ))}
        </div>

        {/* UTR upload for bank transfer — FR-12 */}
        {paymentMethod === "BANK_TRANSFER" && (
          <div className="mt-4 border-2 border-dashed border-slate-200 rounded-lg p-4 text-center">
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" id="utr-upload" className="hidden" />
            <label htmlFor="utr-upload" className="text-sm text-blue-700 cursor-pointer hover:underline">
              Upload UTR / Bank Receipt
            </label>
          </div>
        )}
      </div>

      {/* Order total */}
      <div className="panel p-5 space-y-3">
        <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>INR {cart.summary.subtotal.toLocaleString("en-IN")}</span></div>
        <div className="flex justify-between text-sm text-slate-500"><span>GST</span><span>INR {gst.toLocaleString("en-IN")}</span></div>
        <div className="flex justify-between font-bold text-slate-800 border-t border-slate-100 pt-3"><span>Total</span><span>INR {total.toLocaleString("en-IN")}</span></div>
        <button
          onClick={handlePlaceOrder}
          disabled={loading || cart.items.length === 0}
          className="w-full bg-blue-700 hover:bg-blue-800 text-white rounded-lg py-3 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loading ? "Processing..." : "Place Order — Verify with OTP"}
        </button>
        {error ? <p className="text-xs text-red-600 text-center">{error}</p> : null}
        <p className="text-xs text-slate-400 text-center">
          GST e-invoice (IRN) will be emailed after payment — FR-11
        </p>
      </div>
    </div>
  );
}
