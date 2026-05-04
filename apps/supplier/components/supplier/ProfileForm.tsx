"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ProfileFormProps = {
  initial: {
    companyName: string;
    contactName: string;
    email: string;
    phone: string;
    whatsappNumber: string;
    bisLicenceNo: string;
  };
};

export function ProfileForm({ initial }: ProfileFormProps) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus(null);

    try {
      await axios.patch("/api/supplier/profile", form);
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  function updateField(field: keyof typeof form, value: string) {
    setStatus(null);
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <section className="panel p-5">
      <h3 className="text-xl font-extrabold text-slate-900">Company Profile</h3>
      <p className="mt-1 text-sm text-slate-600">Maintain the supplier entity and contact details stored in Prisma.</p>

      <form onSubmit={onSubmit} className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm text-slate-700">
          <span>Company Name</span>
          <input value={form.companyName} onChange={(e) => updateField("companyName", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="space-y-1 text-sm text-slate-700">
          <span>Contact Name</span>
          <input value={form.contactName} onChange={(e) => updateField("contactName", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="space-y-1 text-sm text-slate-700">
          <span>Email</span>
          <input value={form.email} onChange={(e) => updateField("email", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="space-y-1 text-sm text-slate-700">
          <span>Phone</span>
          <input value={form.phone} onChange={(e) => updateField("phone", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="space-y-1 text-sm text-slate-700">
          <span>WhatsApp Number</span>
          <input value={form.whatsappNumber} onChange={(e) => updateField("whatsappNumber", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="space-y-1 text-sm text-slate-700">
          <span>BIS Licence Number</span>
          <input value={form.bisLicenceNo} onChange={(e) => updateField("bisLicenceNo", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <div className="md:col-span-2">
          <button type="submit" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white">
            Save Profile
          </button>
        </div>
      </form>

      {status === "saved" ? <p className="mt-3 text-sm font-semibold text-emerald-700">Profile saved successfully.</p> : null}
      {status === "error" ? <p className="mt-3 text-sm font-semibold text-red-700">Unable to save profile right now.</p> : null}
    </section>
  );
}