"use client";

import { useMemo, useState } from "react";

type ListingFormProps = {
  mode: "create" | "edit";
  initial?: {
    title: string;
    category: string;
    grade: string;
    moq: string;
    price: string;
    city: string;
  };
};

export function ListingForm({ mode, initial }: ListingFormProps) {
  const seed = useMemo(
    () =>
      initial ?? {
        title: "",
        category: "Steel",
        grade: "Fe500",
        moq: "",
        price: "",
        city: "Chennai",
      },
    [initial]
  );

  const [form, setForm] = useState(seed);
  const [saved, setSaved] = useState(false);

  function updateField(field: keyof typeof form, value: string) {
    setSaved(false);
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(true);
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
          <span>MOQ (MT)</span>
          <input
            required
            value={form.moq}
            onChange={(e) => updateField("moq", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="10"
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
          <span>Dispatch City</span>
          <input
            required
            value={form.city}
            onChange={(e) => updateField("city", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Chennai"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">
          {mode === "create" ? "Publish Listing" : "Save Changes"}
        </button>
        <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
          Save Draft
        </button>
      </div>

      {saved ? <p className="text-sm font-semibold text-emerald-700">Listing saved successfully.</p> : null}
    </form>
  );
}