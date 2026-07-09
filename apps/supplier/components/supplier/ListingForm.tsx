"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type PricingTierRow = {
  minQty: string;
  maxQty: string;
  price: string;
};

type AggregationTierRow = {
  minQty: string;
  unitPrice: string;
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
    aggregationEnabled?: boolean;
    aggregationPriceTiers?: { minQty: number; unitPrice: number }[];
    aggregationWindowDays?: number;
    images?: string[];
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
  const [images, setImages] = useState<string[]>(
    initial?.images && initial.images.length > 0 ? initial.images : [""]
  );

  const [tiers, setTiers] = useState<PricingTierRow[]>(
    initial?.pricingTiers && initial.pricingTiers.length > 0
      ? initial.pricingTiers
      : [{ minQty: "1", maxQty: "", price: seed.price }]
  );
  const [aggregationEnabled, setAggregationEnabled] = useState<boolean>(Boolean(initial?.aggregationEnabled));
  const [aggregationTiers, setAggregationTiers] = useState<AggregationTierRow[]>(
    initial?.aggregationPriceTiers && initial.aggregationPriceTiers.length > 0
      ? initial.aggregationPriceTiers.map((tier) => ({ minQty: String(tier.minQty), unitPrice: String(tier.unitPrice) }))
      : [{ minQty: "", unitPrice: "" }]
  );
  const [aggregationWindowDays, setAggregationWindowDays] = useState<string>(
    initial?.aggregationWindowDays ? String(initial.aggregationWindowDays) : "7"
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateAggregationTier(index: number, field: keyof AggregationTierRow, value: string) {
    setSaved(false);
    setAggregationTiers((prev) => prev.map((tier, tierIndex) => (tierIndex === index ? { ...tier, [field]: value } : tier)));
  }

  function addAggregationTier() {
    setSaved(false);
    setAggregationTiers((prev) => [...prev, { minQty: "", unitPrice: "" }]);
  }

  function removeAggregationTier(index: number) {
    setSaved(false);
    setAggregationTiers((prev) => prev.filter((_, tierIndex) => tierIndex !== index));
  }

  function validateAggregationTiers(): string | null {
    if (!aggregationEnabled) return null;

    const filled = aggregationTiers.filter((tier) => tier.minQty !== "" || tier.unitPrice !== "");
    if (filled.length === 0) {
      return "Add at least one group-pricing tier or disable Group Pricing.";
    }

    for (let index = 0; index < filled.length; index += 1) {
      const minQty = Number(filled[index].minQty);
      const unitPrice = Number(filled[index].unitPrice);
      if (!Number.isInteger(minQty) || minQty < 1) {
        return `Group pricing tier ${index + 1}: minimum quantity must be a positive whole number.`;
      }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return `Group pricing tier ${index + 1}: unit price must be a positive number.`;
      }
    }

    const days = Number(aggregationWindowDays);
    if (!Number.isInteger(days) || days < 1) {
      return "Aggregation window (days) must be a positive whole number.";
    }

    return null;
  }


  function updateField(field: keyof typeof form, value: string) {
    setSaved(false);
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateImage(index: number, value: string) {
    setSaved(false);
    setImages((prev) => prev.map((url, urlIndex) => (urlIndex === index ? value : url)));
  }

  function addImage() {
    setSaved(false);
    setImages((prev) => [...prev, ""]);
  }

  function removeImage(index: number) {
    setSaved(false);
    setImages((prev) => prev.filter((_, urlIndex) => urlIndex !== index));
  }


  function updateTier(index: number, field: keyof PricingTierRow, value: string) {
    setSaved(false);
    setTiers((prev) => {
      // Update the target tier
      const updated = prev.map((tier, tierIndex) => (tierIndex === index ? { ...tier, [field]: value } : tier));

      if (field === "maxQty") {
        const maxQtyNum = Number(value);
        const serviceableQty = Number(form.maxServiceableQty);

        // Truncate all tiers after the edited one so ranges stay consistent
        const truncated = updated.slice(0, index + 1);

        // Auto-append a new tier if the entered maxQty is a valid integer less than maxServiceableQty
        if (
          value !== "" &&
          Number.isInteger(maxQtyNum) &&
          maxQtyNum >= 1 &&
          Number.isInteger(serviceableQty) &&
          serviceableQty >= 1 &&
          maxQtyNum < serviceableQty
        ) {
          return [...truncated, { minQty: String(maxQtyNum + 1), maxQty: "", price: form.price }];
        }

        return truncated;
      }

      return updated;
    });
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

    const aggregationError = validateAggregationTiers();
    if (aggregationError) {
      setError(aggregationError);
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
        images: images.map((url) => url.trim()).filter((url) => url.length > 0),
      };

      let savedListingId = listingId;

      if (mode === "create") {
        const created = await axios.post("/api/supplier/listings", payload);
        savedListingId = created.data?.id;
      } else {
        await axios.patch(`/api/supplier/listings/${listingId}`, payload);
      }

      if (savedListingId) {
        await axios.patch(`/api/supplier/listings/${savedListingId}/aggregation-settings`, {
          aggregationEnabled,
          priceTiers: aggregationTiers.filter((tier) => tier.minQty !== "" && tier.unitPrice !== ""),
          defaultWindowDays: aggregationWindowDays,
        });
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
        <div>
          <h4 className="text-lg font-bold text-slate-900">Product Photos</h4>
          <p className="text-sm text-slate-600">
            Add image URLs to showcase your product. If no photo is added, a default image for the selected category
            will be shown to builders across the marketplace.
          </p>
        </div>

        <div className="space-y-3">
          {images.map((url, index) => (
            <div key={index} className="flex items-start gap-3">
              <div className="flex-1 space-y-1">
                <input
                  value={url}
                  onChange={(e) => updateImage(index, e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="https://example.com/product-photo.jpg"
                />
              </div>
              {url.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt="Preview"
                  className="h-10 w-10 rounded-lg border border-slate-200 object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : null}
              <button
                type="button"
                onClick={() => removeImage(index)}
                disabled={images.length === 1}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addImage}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          + Add Another Photo
        </button>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div>
          <h4 className="text-lg font-bold text-slate-900">Tiered Pricing</h4>
          <p className="text-sm text-slate-600">Define contiguous ranges from MOQ 1 up to your maximum serviceable quantity. The next tier is added automatically as you fill in each Max Qty.</p>
        </div>

        <div className="space-y-3">
          {tiers.map((tier, index) => (
            <div key={index} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
              <label className="space-y-1 text-sm text-slate-700">
                <span>Min Qty</span>
                <input
                  value={tier.minQty}
                  onChange={(e) => updateTier(index, "minQty", e.target.value)}
                  readOnly={index > 0}
                  className={`w-full rounded-lg border border-slate-300 px-3 py-2 ${index > 0 ? "bg-slate-100 text-slate-500" : ""}`}
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

      <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-lg font-bold text-slate-900">Enable Group Pricing (Aggregation)</h4>
            <p className="text-sm text-slate-600">
              Let builders in the same zone pool orders together and unlock lower prices as demand grows.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={aggregationEnabled}
              onChange={(e) => {
                setSaved(false);
                setAggregationEnabled(e.target.checked);
              }}
              className="h-5 w-5 rounded border-slate-300"
            />
            {aggregationEnabled ? "Enabled" : "Disabled"}
          </label>
        </div>

        {aggregationEnabled ? (
          <>
            <label className="block max-w-xs space-y-1 text-sm text-slate-700">
              <span>Aggregation Window (days)</span>
              <input
                value={aggregationWindowDays}
                onChange={(e) => {
                  setSaved(false);
                  setAggregationWindowDays(e.target.value);
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="7"
              />
              <p className="text-xs text-slate-500">Pools lock automatically after this many days if the top tier isn't reached.</p>
            </label>

            <div className="space-y-3">
              {aggregationTiers.map((tier, index) => (
                <div key={index} className="grid gap-3 rounded-lg border border-emerald-200 bg-white p-3 md:grid-cols-[1fr_1fr_auto]">
                  <label className="space-y-1 text-sm text-slate-700">
                    <span>Minimum Pool Quantity</span>
                    <input
                      value={tier.minQty}
                      onChange={(e) => updateAggregationTier(index, "minQty", e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      placeholder="50"
                    />
                  </label>
                  <label className="space-y-1 text-sm text-slate-700">
                    <span>Unit Price at this Tier (INR)</span>
                    <input
                      value={tier.unitPrice}
                      onChange={(e) => updateAggregationTier(index, "unitPrice", e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      placeholder={form.price || "0"}
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => removeAggregationTier(index)}
                      disabled={aggregationTiers.length === 1}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addAggregationTier}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              + Add Tier
            </button>

            <p className="text-xs text-slate-500">
              Example: 50 units at ₹590, 100 units at ₹560, 200 units at ₹520 — price drops as the pool grows.
            </p>
          </>
        ) : null}
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