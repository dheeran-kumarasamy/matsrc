"use client";

import { useEffect, useState } from "react";
import { builderApiGet } from "@/lib/api";
import AddAdvanceForm from "@/components/advance/AddAdvanceForm";
import AdvanceTransactionHistory from "@/components/advance/AdvanceTransactionHistory";

type AdvanceBalance = {
  availableBalance: number;
  pendingAdvance: number;
  currency: string;
  status: string;
};

// Buildohub Advance Balance — buyer-facing landing page (spec §11).
// Displays available balance + pending advance SEPARATELY (pending never
// counted as spendable), an "Add Advance" entry point, and the full
// transaction history.
export default function AdvanceBalancePage() {
  const [balance, setBalance] = useState<AdvanceBalance | null>(null);
  const [showAddAdvance, setShowAddAdvance] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    builderApiGet<AdvanceBalance>("/advance")
      .then((data) => {
        if (active) setBalance(data);
      })
      .catch(() => {
        if (active) setBalance({ availableBalance: 0, pendingAdvance: 0, currency: "INR", status: "ACTIVE" });
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  function handleSubmitted() {
    setShowAddAdvance(false);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="posh-body mx-auto max-w-2xl space-y-5">
      <header>
        <p className="posh-eyebrow">Buildohub</p>
        <h1 className="posh-page-title mt-2">Advance Balance</h1>
      </header>

      <div className="posh-card space-y-4 p-6">
        <div>
          <p className="posh-label">Available Balance</p>
          <p className="mt-1 text-3xl font-extrabold text-[color:var(--posh-fg)]">
            ₹{(balance?.availableBalance ?? 0).toLocaleString("en-IN")}
          </p>
        </div>

        {balance && balance.pendingAdvance > 0 ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="posh-label text-amber-700">Pending Advance</p>
            <p className="mt-1 text-lg font-bold">₹{balance.pendingAdvance.toLocaleString("en-IN")}</p>
            <p className="mt-1 text-xs">Awaiting admin verification — not yet available to spend.</p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setShowAddAdvance((v) => !v)}
          className="posh-btn-solid rounded-lg px-4 py-2 text-sm font-semibold"
        >
          {showAddAdvance ? "Cancel" : "Add Advance"}
        </button>

        {showAddAdvance ? <AddAdvanceForm onSubmitted={handleSubmitted} /> : null}
      </div>

      <AdvanceTransactionHistory key={refreshKey} />
    </div>
  );
}
