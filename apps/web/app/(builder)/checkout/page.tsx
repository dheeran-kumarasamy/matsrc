"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MfaVerification from "@/components/checkout/MfaVerification";

type PaymentMethod = "UPI" | "CARD" | "NET_BANKING" | "COD" | "CREDIT" | "BANK_TRANSFER";

// UF-03: Checkout & Payment — FR-09, FR-10, FR-11, FR-12
export default function CheckoutPage() {
  const router = useRouter();
  const [step, setStep] = useState<"review" | "delivery" | "payment" | "mfa">("review");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("UPI");
  const [loading, setLoading] = useState(false);

  const paymentOptions: { value: PaymentMethod; label: string; desc: string }[] = [
    { value: "UPI", label: "UPI", desc: "Pay via any UPI app" },
    { value: "CARD", label: "Debit / Credit Card", desc: "Visa, Mastercard, RuPay" },
    { value: "NET_BANKING", label: "Net Banking", desc: "All major banks" },
    { value: "COD", label: "Cash on Delivery", desc: "Pay when goods arrive" },
    { value: "CREDIT", label: "Credit / BNPL", desc: "EMI, 30/60/90-day pay later" },
    { value: "BANK_TRANSFER", label: "NEFT / RTGS", desc: "Upload UTR as proof" },
  ];

  async function handlePlaceOrder() {
    setLoading(true);
    // MFA required before payment — FR-03
    setStep("mfa");
    setLoading(false);
  }

  if (step === "mfa") {
    return <MfaVerification onVerified={() => router.push("/orders")} />;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-gray-900">Checkout</h1>

      {/* Step 1: Review cart */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-3">1. Review Cart</h2>
        <p className="text-sm text-gray-400">Stock re-validated against live supplier inventory.</p>
        <div className="mt-3 text-center py-4 text-gray-300 text-sm border border-dashed border-gray-200 rounded-lg">
          Cart items appear here
        </div>
      </div>

      {/* Step 2: Delivery dates — FR-10 */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-3">2. Preferred Delivery Dates</h2>
        <p className="text-xs text-gray-400 mb-3">Set a preferred delivery date per supplier.</p>
        <div className="border border-gray-100 rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm text-gray-700">Raipur Steel Co.</span>
          <input type="date" className="text-xs border border-gray-200 rounded px-2 py-1" />
        </div>
      </div>

      {/* Step 3: Payment method — FR-11, FR-12 */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-3">3. Payment Method</h2>
        <div className="space-y-2">
          {paymentOptions.map(({ value, label, desc }) => (
            <label key={value} className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${paymentMethod === value ? "border-brand-500 bg-brand-50" : "border-gray-100 hover:border-gray-200"}`}>
              <input
                type="radio"
                name="payment"
                value={value}
                checked={paymentMethod === value}
                onChange={() => setPaymentMethod(value)}
                className="accent-brand-500"
              />
              <div>
                <div className="text-sm font-medium text-gray-800">{label}</div>
                <div className="text-xs text-gray-400">{desc}</div>
              </div>
            </label>
          ))}
        </div>

        {/* UTR upload for bank transfer — FR-12 */}
        {paymentMethod === "BANK_TRANSFER" && (
          <div className="mt-4 border-2 border-dashed border-gray-200 rounded-lg p-4 text-center">
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" id="utr-upload" className="hidden" />
            <label htmlFor="utr-upload" className="text-sm text-brand-500 cursor-pointer hover:underline">
              Upload UTR / Bank Receipt
            </label>
          </div>
        )}
      </div>

      {/* Order total */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
        <div className="flex justify-between text-sm text-gray-500"><span>Subtotal</span><span>₹0</span></div>
        <div className="flex justify-between text-sm text-gray-500"><span>GST</span><span>₹0</span></div>
        <div className="flex justify-between font-bold text-gray-800 border-t border-gray-100 pt-3"><span>Total</span><span>₹0</span></div>
        <button
          onClick={handlePlaceOrder}
          disabled={loading}
          className="w-full bg-brand-500 hover:bg-brand-600 text-white rounded-lg py-3 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loading ? "Processing..." : "Place Order — Verify with OTP"}
        </button>
        <p className="text-xs text-gray-400 text-center">
          GST e-invoice (IRN) will be emailed after payment — FR-11
        </p>
      </div>
    </div>
  );
}
