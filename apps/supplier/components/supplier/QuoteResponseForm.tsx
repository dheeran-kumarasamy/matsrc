"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function QuoteResponseForm({ rfqId }: { rfqId: string | null }) {
  const router = useRouter();
  const [price, setPrice] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  if (!rfqId) {
    return null;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);

    try {
      await axios.post(`/api/supplier/rfqs/${rfqId}/quote`, { price, validUntil, notes });
      setMessage("Quote submitted.");
      router.refresh();
    } catch {
      setMessage("Unable to submit quote.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel grid gap-3 p-5 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
      <label className="space-y-1 text-sm text-slate-700">
        <span>Quote Price</span>
        <input required value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      <label className="space-y-1 text-sm text-slate-700">
        <span>Valid Until</span>
        <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      <label className="space-y-1 text-sm text-slate-700">
        <span>Notes</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Dispatch window or freight assumptions" />
      </label>
      <button type="submit" className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white">
        Submit Quote
      </button>
      {message ? <p className="md:col-span-4 text-sm font-semibold text-slate-700">{message}</p> : null}
    </form>
  );
}