"use client";

import { useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";

interface Props { floating?: boolean }

// FR-32: Quick Material Request Form — always available, < 30 seconds
export default function QuickRequestForm({ floating }: Props) {
  const [open, setOpen] = useState(false);
  const [material, setMaterial] = useState("");
  const [quantity, setQuantity] = useState("");
  const [pincode, setPincode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/quick-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialName: material, quantity, pincode }),
    });
    setSubmitted(true);
    setLoading(false);
  }

  if (floating) {
    return (
      <>
        {/* Floating trigger button */}
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex min-h-[44px] items-center gap-2 rounded-full bg-accent-500 px-5 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-accent-600"
        >
          <MessageSquarePlus size={18} />
          <span className="hidden sm:inline">Quick Request</span>
        </button>

        {/* Modal */}
        {open && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-800">Quick Material Request</h3>
                <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
              </div>

              {submitted ? (
                <div className="text-center py-6">
                  <div className="text-4xl mb-2">✅</div>
                  <p className="font-medium text-slate-800">Request Submitted!</p>
                  <p className="text-sm text-slate-400 mt-1">Suppliers will respond with quotes shortly.</p>
                  <button onClick={() => { setOpen(false); setSubmitted(false); setMaterial(""); setQuantity(""); setPincode(""); }} className="mt-4 text-xs text-blue-700 hover:underline">Submit another</button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-3">
                  <input
                    required
                    placeholder="Material name (e.g. TMT Bar Fe-500D)"
                    value={material}
                    onChange={(e) => setMaterial(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                  <input
                    required
                    placeholder="Quantity (e.g. 10 MT)"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                  <input
                    required
                    placeholder="Delivery pincode"
                    maxLength={6}
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                  <button type="submit" disabled={loading} className="w-full bg-accent-500 hover:bg-accent-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
                    {loading ? "Submitting..." : "Get Quotes from Suppliers"}
                  </button>
                  <p className="text-xs text-slate-400 text-center">Takes less than 30 seconds</p>
                </form>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
