"use client";

import { useEffect, useState } from "react";
import { builderApiGet } from "@/lib/api";

type Transaction = {
  id: string;
  type: "CREDIT" | "ORDER_PAYMENT" | "REFUND" | "REVERSAL" | "ADJUSTMENT" | "ADVANCE_RESERVATION" | "ADVANCE_RELEASE";
  amount: number;
  balanceAfter: number;
  reference: string | null;
  orderReference: string | null;
  advancePaymentReference: string | null;
  createdAt: string;
};

// §25/§32: the ledger now distinguishes RESERVING money (still pending
// settlement) from genuinely CONSUMING it (ORDER_PAYMENT, only written once
// the order's payment is confirmed) and RELEASING a reservation back
// (rejected/cancelled order) — never a misleading permanent debit shown the
// moment the buyer merely applies advance to an order.
const LABELS: Record<Transaction["type"], string> = {
  CREDIT: "Advance Payment",
  ORDER_PAYMENT: "Order Payment",
  REFUND: "Refund",
  REVERSAL: "Reversal",
  ADJUSTMENT: "Adjustment",
  ADVANCE_RESERVATION: "Advance Reserved",
  ADVANCE_RELEASE: "Advance Released",
};

const IS_CREDIT: Record<Transaction["type"], boolean> = {
  CREDIT: true,
  ORDER_PAYMENT: false,
  REFUND: true,
  REVERSAL: false,
  ADJUSTMENT: true,
  // A reservation moves money OUT of the available balance (shown as a
  // debit here, even though it isn't yet a genuine spend) and a release
  // moves it back IN — mirrors the balance-column sign convention in
  // packages/db/lib/advance-ledger.ts's balanceEffect().
  ADVANCE_RESERVATION: false,
  ADVANCE_RELEASE: true,
};

// Buyer-facing Advance Balance History (spec §18) — reuses the existing
// Buildohub card/list styling used throughout apps/web (no new table
// component introduced).
export default function AdvanceTransactionHistory() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    builderApiGet<{ transactions: Transaction[] }>("/advance/transactions")
      .then((data) => {
        if (active) setTransactions(data.transactions || []);
      })
      .catch(() => {
        if (active) setTransactions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="posh-card space-y-3 p-6">
      <h2 className="posh-card-title">Advance Balance History</h2>

      {loading ? (
        <p className="text-sm text-[color:var(--posh-fg-muted)]">Loading…</p>
      ) : transactions.length === 0 ? (
        <p className="text-sm text-[color:var(--posh-fg-muted)]">No advance transactions yet.</p>
      ) : (
        <div className="space-y-3">
          {transactions.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-xl border border-[color:var(--posh-border)] px-4 py-3"
            >
              <div>
                <p className="text-xs text-[color:var(--posh-fg-muted)]">
                  {new Date(t.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
                <p className="mt-1 text-sm font-bold text-[color:var(--posh-fg)]">{LABELS[t.type]}</p>
                <p className="text-xs text-[color:var(--posh-fg-muted)]">
                  {t.advancePaymentReference ?? t.orderReference ?? t.reference ?? ""}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${IS_CREDIT[t.type] ? "text-emerald-700" : "text-rose-700"}`}>
                  {IS_CREDIT[t.type] ? "+" : "-"} ₹{t.amount.toLocaleString("en-IN")}
                </p>
                <p className="text-xs text-[color:var(--posh-fg-muted)]">Balance: ₹{t.balanceAfter.toLocaleString("en-IN")}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
