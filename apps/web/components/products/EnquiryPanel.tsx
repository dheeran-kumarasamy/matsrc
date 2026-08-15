"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ShoppingCart } from "lucide-react";
import { useCartStore } from "@/lib/store/cart-store";
import { useOverlayStore } from "@/lib/store/overlay-store";
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
  const addItem = useCartStore((state) => state.addItem);
  const openCart = useOverlayStore((state) => state.openCart);
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [quantity, setQuantity] = useState(1);
  // BUG-06 fix: track the raw text the user is typing separately from the
  // committed numeric `quantity`. Previously the input's `value` was tied
  // directly to `quantity`, and clearing the field to type a new multi-digit
  // number produced an empty string which `Number(value || 1)` treated as
  // falsy, immediately snapping the field back to 1 mid-keystroke. Now the
  // input tolerates a transient empty/partial string while typing, and only
  // clamps/validates to [1, maxServiceableQty] on blur (or Enter).
  const [quantityInput, setQuantityInput] = useState("1");
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTier = useMemo(() => findTier(pricingTiers, quantity), [pricingTiers, quantity]);
  const unitPrice = useMemo(() => parseTierPrice(selectedTier?.price ?? "0"), [selectedTier]);
  const lineTotal = unitPrice * quantity;

  function commitQuantity(rawValue: string) {
    const parsed = Number(rawValue);
    if (!rawValue.trim() || !Number.isFinite(parsed) || parsed < 1) {
      setQuantityError(`Enter a quantity of at least 1 ${unit}.`);
      setQuantity(1);
      setQuantityInput("1");
      return;
    }
    if (parsed > maxServiceableQty) {
      setQuantityError(`Maximum serviceable quantity is ${maxServiceableQty} ${unit}.`);
      setQuantity(maxServiceableQty);
      setQuantityInput(String(maxServiceableQty));
      return;
    }
    setQuantityError(null);
    const clamped = Math.floor(parsed);
    setQuantity(clamped);
    setQuantityInput(String(clamped));
  }

  async function handleAddToEnquiry() {
    setLoading(true);
    setError(null);
    try {
      await addItem(productId, quantity);
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
      // Open the persistent cart drawer instead of navigating away — keeps
      // the PLP/quick-view underneath mounted (spec section 5A).
      openCart("review");
      return;
    }

    // Ordering must require login — prompt the builder to sign in before
    // this first cart-mutation action instead of failing silently later.
    if (sessionStatus !== "authenticated") {
      router.push(`/auth/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
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
            value={quantityInput}
            onChange={(event) => {
              // Allow the user to freely type/clear/edit digits without the
              // value being clamped or reset on every keystroke.
              setQuantityInput(event.target.value);
              setAdded(false);
              if (quantityError) setQuantityError(null);
            }}
            onBlur={(event) => commitQuantity(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitQuantity((event.target as HTMLInputElement).value);
              }
            }}
            aria-invalid={quantityError ? true : undefined}
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              quantityError ? "border-black focus:ring-black" : "border-black/15 focus:ring-black"
            }`}
          />
        </label>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Selected tier</p>
          <p className="font-medium text-slate-800">
            {selectedTier ? `${selectedTier.minQty} - ${selectedTier.maxQty} ${unit}` : `1 - ${maxServiceableQty} ${unit}`}
          </p>
        </div>
      </div>
      {quantityError ? <p className="text-xs font-bold text-black">{quantityError}</p> : null}

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
          added ? "border border-black bg-white text-black" : "bg-black text-white hover:bg-black/85"
        }`}
      >
        <ShoppingCart size={16} />
        {added ? "Go to Cart" : loading ? "Adding..." : "Add to Enquiry Basket"}
      </button>

      {error ? <p className="text-xs font-bold text-black">{error}</p> : null}
      <p className="text-xs text-slate-400">
        This adds the material to your enquiry basket. Checkout will submit a supplier enquiry, not a payment.
      </p>
    </div>
  );
}
