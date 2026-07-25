"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { MessageSquarePlus, X } from "lucide-react";
import { builderApiPost } from "@/lib/api";

interface Props { floating?: boolean }

type QuickRequestResponse =
  | { matched: true; stage: string; orders: { id: string; supplierName: string; total: number; itemCount: number }[] }
  | { matched: false; message: string };

// FR-32: Quick Material Request Form — always available, < 30 seconds.
// Submits a real nearest-match enquiry via /api/builder/quick-request, which
// reuses the same cart/checkout enquiry pipeline (UF-03) so resulting
// enquiries show up identically in /orders.
export default function QuickRequestForm({ floating }: Props) {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [open, setOpen] = useState(false);
  const [material, setMaterial] = useState("");
  const [quantity, setQuantity] = useState("");
  const [pincode, setPincode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [noMatchMessage, setNoMatchMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (sessionStatus !== "authenticated") {
      router.push(`/auth/login?callbackUrl=${encodeURIComponent("/")}`);
      return;
    }

    setLoading(true);
    setError(null);
    setNoMatchMessage(null);

    try {
      const response = await builderApiPost<QuickRequestResponse>("/quick-request", {
        materialName: material,
        quantity,
        pincode,
      });

      if (response.matched) {
        setSubmitted(true);
      } else {
        setNoMatchMessage(response.message);
      }
    } catch {
      setError("Unable to submit your request right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setOpen(false);
    setSubmitted(false);
    setNoMatchMessage(null);
    setError(null);
    setMaterial("");
    setQuantity("");
    setPincode("");
  }

  if (floating) {
    return (
      <>
        <button onClick={() => setOpen(true)} className="fixed bottom-6 right-6 z-40 flex min-h-[44px] items-center gap-2 rounded-full bg-accent-500 px-5 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-accent-600">
          <MessageSquarePlus size={18} />
          <span className="hidden sm:inline">Quick Request</span>
        </button>
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
                  <button onClick={() => router.push("/orders")} className="mt-4 block w-full text-xs text-blue-700 hover:underline">View my orders</button>
                  <button onClick={reset} className="mt-2 text-xs text-slate-400 hover:underline">Submit another</button>
                </div>
              ) : noMatchMessage ? (
                <div className="text-center py-6">
                  <div className="text-4xl mb-2">🔍</div>
                  <p className="font-medium text-slate-800">No close match found</p>
                  <p className="text-sm text-slate-400 mt-1">{noMatchMessage}</p>
                  <button onClick={() => { setOpen(false); router.push("/products"); }} className="mt-4 block w-full text-xs text-blue-700 hover:underline">Browse categories</button>
                  <button onClick={() => setNoMatchMessage(null)} className="mt-2 text-xs text-slate-400 hover:underline">Try a different search</button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-3">
                  <input required placeholder="Material name (e.g. TMT Bar Fe-500D)" value={material} onChange={(e) => setMaterial(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-700" />
                  <input required placeholder="Quantity (e.g. 10 MT)" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-700" />
                  <input required placeholder="Delivery pincode" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-700" />
                  {error && <p className="text-xs text-red-600">{error}</p>}
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
