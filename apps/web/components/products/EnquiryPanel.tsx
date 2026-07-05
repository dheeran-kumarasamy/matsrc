"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { builderApiPost } from "@/lib/api";
import { recordInterestEvent } from "@/lib/interest-events";

type PricingTier = {
  minQty: string;
  maxQty: string;
  price: string;
};

type Props = {
  productId: string;
  unit: string;
  maxServiceableQty: number;
  pricingTiers: PricingTier[];
};

function parseTierPrice(value: string) {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function findTier(pricingTiers: PricingTier[], quantity: number) {
  return pricingTiers.find((tier) => {
    const minQty = Number(tier.minQty);
    const maxQty = Number(tier.maxQty);
    return quantity >= minQty && quantity <= maxQty;
  }) ?? pricingTiers[0];
}

export default function EnquiryPanel({ productId, unit, maxServiceableQty, pricingTiers }: Props) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTier = useMemo(() => findTier(pricingTiers, quantity), [pricingTiers, quantity]);
  const unitPrice = useMemo(() => parseTierPrice(selectedTier?.price ?? "0"), [selectedTier]);
  const lineTotal = unitPrice * quantity;

  async function handleAddToEnquiry() {
    setLoading(true);
    setError(null);
    try {
      await builderApiPost("/cart/items", { productId, quantity });
      void recordInterestEvent(productId, "CART_ADD");
      setAdded(true);
    } catch {
      setError("Unable to add this material to your enquiry basket.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePrimaryAction() {
    if (added) {
      router.push("/cart");
      return;
    }

    await handleAddToEnquiry();
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Enquiry Basket</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">Select quantity and review tier price</h2>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Tier price</p>
          <p className="text-lg font-bold text-slate-900">₹{unitPrice.toLocaleString("en-IN")}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Quantity ({unit})</span>
          <input
            type="number"
            min={1}
            max={maxServiceableQty}
            value={quantity}
            onChange={(event) => {
              const nextQuantity = Number(event.target.value || 1);
              setQuantity(Math.min(Math.max(nextQuantity, 1), maxServiceableQty));
              setAdded(false);
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
        </label>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Selected tier</p>
          <p className="font-medium text-slate-800">
            {selectedTier ? `${selectedTier.minQty} - ${selectedTier.maxQty} ${unit}` : `1 - ${maxServiceableQty} ${unit}`}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-slate-200 p-3">
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Estimated enquiry value</span>
          <span className="font-semibold text-slate-900">₹{lineTotal.toLocaleString("en-IN")}</span>
        </div>
      </div>

      <button
        onClick={() => void handlePrimaryAction()}
        disabled={loading}
        className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
          added ? "bg-emerald-700 text-white hover:bg-emerald-800" : "bg-blue-700 text-white hover:bg-blue-800"
        }`}
      >
        <ShoppingCart size={16} />
        {added ? "Go to Cart" : loading ? "Adding..." : "Add to Enquiry Basket"}
      </button>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <p className="text-xs text-slate-400">
        This adds the material to your enquiry basket. Checkout will submit a supplier enquiry, not a payment.
      </p>
    </div>
  );
}
