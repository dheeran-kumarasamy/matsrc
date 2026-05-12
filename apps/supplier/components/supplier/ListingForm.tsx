"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type PricingTierRow = {
  minQty: string;
  maxQty: string;
  price: string;
};

type ListingFormProps = {
  mode: "create" | "edit";
  listingId?: string;
  initial?: {
    title: string;
    category: string;
    grade: string;
    unit: string;
    maxServiceableQty: string;
    price: string;
    brand: string;
    description: string;
    pricingTiers?: PricingTierRow[];
  };
};

export function ListingForm({ mode, listingId, initial }: ListingFormProps) {
  const router = useRouter();
  const seed = useMemo(
    () =>
      initial ?? {
        title: "",
        category: "Steel",
        grade: "Fe500",
        unit: "MT",
        maxServiceableQty: "",
        price: "",
        brand: "",
        description: "",
      },
    [initial]
  );

  const [form, setForm] = useState(seed);
  const [tiers, setTiers] = useState<PricingTierRow[]>(
    initial?.pricingTiers && initial.pricingTiers.length > 0
      ? initial.pricingTiers
      : [{ minQty: "1", maxQty: "", price: seed.price }]
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateField(field: keyof typeof form, value: string) {
    setSaved(false);
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateTier(index: number, field: keyof PricingTierRow, value: string) {
    setSaved(false);
    setTiers((prev) => prev.map((tier, tierIndex) => (tierIndex === index ? { ...tier, [field]: value } : tier)));
  }

  function addTier() {
    setSaved(false);
    setTiers((prev) => [...prev, { minQty: "", maxQty: "", price: form.price }]);
  }

  function removeTier(index: number) {
    setSaved(false);
    setTiers((prev) => prev.filter((_, tierIndex) => tierIndex !== index));
  }

  function validateTiers() {
    const serviceableQty = Number(form.maxServiceableQty);
    if (!Number.isInteger(serviceableQty) || serviceableQty < 1) {
      return "Maximum Serviceable Quantity must be a positive whole number.";
    }

    if (tiers.length === 0) {
      return "Add at least one pricing tier.";
    }

    const normalized = tiers.map((tier, index) => {
      const minQty = Number(tier.minQty);
      const maxQty = Number(tier.maxQty);
      const price = Number(tier.price);

      if (!Number.isInteger(minQty) || minQty < 1) return `Tier ${index + 1} minimum quantity must be a positive whole number.`;
      if (!Number.isInteger(maxQty) || maxQty < 1) return `Tier ${index + 1} maximum quantity must be a positive whole number.`;
      if (!Number.isFinite(price) || price <= 0) return `Tier ${index + 1} price must be a positive number.`;
      if (minQty > maxQty) return `Tier ${index + 1} minimum quantity cannot exceed maximum quantity.`;

      return null;
    });

    const tierError = normalized.find(Boolean);
    if (tierError) return tierError as string;

    const sorted = [...tiers].map((tier) => ({
      minQty: Number(tier.minQty),
      maxQty: Number(tier.maxQty),
      price: Number(tier.price),
    })).sort((a, b) => a.minQty - b.minQty);

    if (sorted[0].minQty !== 1) {
      return "The first tier must start at quantity 1.";
    }

    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].minQty !== sorted[index - 1].maxQty + 1) {
        return "Pricing tiers must be contiguous without gaps or overlaps.";
      }
    }

    if (sorted[sorted.length - 1].maxQty !== serviceableQty) {
      return "The final tier must end at Maximum Serviceable Quantity.";
    }

    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const tierError = validateTiers();
    if (tierError) {
      setError(tierError);
      setSaving(false);
      return;
    }

    try {
      const payload = {
        ...form,
        pricingTiers: tiers.map((tier) => ({
          minQty: tier.minQty,
          maxQty: tier.maxQty,
          price: tier.price,
        })),
      };

      if (mode === "create") {
        await axios.post("/api/supplier/listings", payload);
      } else {
        await axios.patch(`/api/supplier/listings/${listingId}`, payload);
      }

      setSaved(true);
      router.push("/listings");
      router.refresh();
    } catch (err) {
      setError("Unable to save listing right now.");
    } finally {
      setSaving(false);
    }
  }

  const maxServiceableQty = Number(form.maxServiceableQty);

  return (
    <form onSubmit={onSubmit} className="panel space-y-4 p-5">
      <div>
        <h3 className="text-xl font-extrabold text-slate-900">{mode === "create" ? "Create Listing" : "Edit Listing"}</h3>
        <p className="text-sm text-slate-600">Publish verified inventory with transparent MOQ and dispatch city.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm text-slate-700">
          <span>Material Name</span>
          <input
            required
            value={form.title}
            onChange={(e) => updateField("title", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="TMT Bars 12mm"
          />
        </label>

        <label className="space-y-1 text-sm text-slate-700">
          <span>Category</span>
          <select
            value={form.category}
            onChange={(e) => updateField("category", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          >
            <option>Steel</option>
            <option>Cement</option>
            <option>Aggregates</option>
            <option>Pipes</option>
          </select>
        </label>

        <label className="space-y-1 text-sm text-slate-700">
          <span>Grade / Spec</span>
          <input
            required
            value={form.grade}
            onChange={(e) => updateField("grade", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Fe500"
          />
        </label>

        <label className="space-y-1 text-sm text-slate-700">
          <span>Unit</span>
          <select
            value={form.unit}
            onChange={(e) => updateField("unit", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="MT">MT</option>
            <option value="BAG">BAG</option>
            <option value="TON">TON</option>
            <option value="PCS">PCS</option>
          </select>
        </label>

        <label className="space-y-1 text-sm text-slate-700">
          <span>Maximum Serviceable Quantity</span>
          <input
            required
            value={form.maxServiceableQty}
            onChange={(e) => updateField("maxServiceableQty", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="1000"
          />
          <p className="text-xs text-slate-500">Set the total maximum quantity you can service across all price tiers.</p>
        </label>

        <label className="space-y-1 text-sm text-slate-700">
          <span>Base Price (INR)</span>
          <input
            required
            value={form.price}
            onChange={(e) => updateField("price", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="61250"
          />
        </label>

        <label className="space-y-1 text-sm text-slate-700">
          <span>Brand</span>
          <input
            value={form.brand}
            onChange={(e) => updateField("brand", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="TATA"
          />
        </label>

        <label className="space-y-1 text-sm text-slate-700 md:col-span-2">
          <span>Description</span>
          <textarea
            rows={4}
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Quality notes, dispatch readiness, and certification details"
          />
        </label>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-lg font-bold text-slate-900">Tiered Pricing</h4>
            <p className="text-sm text-slate-600">Define contiguous ranges from MOQ 1 up to your maximum serviceable quantity.</p>
          </div>
          <button type="button" onClick={addTier} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
            Add Tier
          </button>
        </div>

        <div className="space-y-3">
          {tiers.map((tier, index) => (
            <div key={index} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
              <label className="space-y-1 text-sm text-slate-700">
                <span>Min Qty</span>
                <input
                  value={tier.minQty}
                  onChange={(e) => updateTier(index, "minQty", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder={index === 0 ? "1" : "6"}
                />
              </label>
              <label className="space-y-1 text-sm text-slate-700">
                <span>Max Qty</span>
                <input
                  value={tier.maxQty}
                  onChange={(e) => updateTier(index, "maxQty", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder={index === tiers.length - 1 && Number.isInteger(maxServiceableQty) ? String(maxServiceableQty) : "10"}
                />
              </label>
              <label className="space-y-1 text-sm text-slate-700">
                <span>Tier Price (INR)</span>
                <input
                  value={tier.price}
                  onChange={(e) => updateTier(index, "price", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder={form.price || "0"}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => removeTier(index)}
                  disabled={tiers.length === 1}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500">
          Example: if Maximum Serviceable Quantity is 1000, you can create tiers like 1-5, 6-20, 21-1000.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-60">
          {mode === "create" ? "Publish Listing" : "Save Changes"}
        </button>
        <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
          Save Draft
        </button>
      </div>

      {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
      {saved ? <p className="text-sm font-semibold text-emerald-700">Listing saved successfully.</p> : null}
    </form>
  );
}