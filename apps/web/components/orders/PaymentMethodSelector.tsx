"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { builderApiPatch } from "@/lib/api";

type Props = {
  orderId: string;
  currentMethod: "UPI" | "CARD" | "NET_BANKING" | "COD" | "CREDIT" | "BANK_TRANSFER";
  bankGuaranteeAvailable: boolean;
};

// REQ-10: Standard vs Bank Guarantee payment method selector. Bank Guarantee
// is only selectable when the builder's Bank Guarantee registration
// (REQ-09) has been approved; otherwise it's shown disabled with a hint to
// register one via the Credit & BNPL page.
export default function PaymentMethodSelector({ orderId, currentMethod, bankGuaranteeAvailable }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<"BANK_TRANSFER" | "CREDIT">(
    currentMethod === "CREDIT" ? "CREDIT" : "BANK_TRANSFER"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectMethod(method: "BANK_TRANSFER" | "CREDIT") {
    if (method === selected || saving) return;
    if (method === "CREDIT" && !bankGuaranteeAvailable) return;

    setError(null);
    setSaving(true);
    const previous = selected;
    setSelected(method);
    try {
      await builderApiPatch(`/orders/${orderId}`, { paymentMethod: method });
      router.refresh();
    } catch {
      setSelected(previous);
      setError("Failed to update payment method. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Payment Method</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => selectMethod("BANK_TRANSFER")}
          disabled={saving}
          className={`rounded-xl border p-4 text-left transition-all disabled:opacity-60 ${
            selected === "BANK_TRANSFER"
              ? "border-blue-700 bg-blue-50"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="text-sm font-semibold text-slate-800">Standard</div>
          <div className="text-xs text-slate-400 mt-1">Pay via bank transfer / UPI as usual</div>
        </button>

        <button
          type="button"
          onClick={() => selectMethod("CREDIT")}
          disabled={saving || !bankGuaranteeAvailable}
          className={`rounded-xl border p-4 text-left transition-all disabled:opacity-50 ${
            selected === "CREDIT"
              ? "border-blue-700 bg-blue-50"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="text-sm font-semibold text-slate-800">Bank Guarantee</div>
          <div className="text-xs text-slate-400 mt-1">
            {bankGuaranteeAvailable
              ? "Pay against your registered bank guarantee"
              : "Register and get your bank guarantee approved in Credit & BNPL to unlock this"}
          </div>
        </button>
      </div>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
