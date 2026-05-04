"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type ListingFormProps = {
  mode: "create" | "edit";
  listingId?: string;
  initial?: {
    title: string;
    category: string;
    grade: string;
    unit: string;
    stock: string;
    price: string;
    brand: string;
    description: string;
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
        stock: "",
        price: "",
        brand: "",
        description: "",
      },
    [initial]
  );

  const [form, setForm] = useState(seed);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateField(field: keyof typeof form, value: string) {
    setSaved(false);
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (mode === "create") {
        await axios.post("/api/supplier/listings", form);
      } else {
        await axios.patch(`/api/supplier/listings/${listingId}`, form);
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
          <span>Available Stock</span>
          <input
            required
            value={form.stock}
            onChange={(e) => updateField("stock", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="120"
          />
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