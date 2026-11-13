"use client";

import { useState } from "react";
import AdvanceUsagePanel from "./AdvanceUsagePanel";
import BankTransferPaymentPanel from "./BankTransferPaymentPanel";
import type { BankAccountDetails } from "@/lib/bank-account-config";

// Thin client wrapper that lifts the shared "current outstanding amount"
// state between the OPTIONAL Buildohub Advance Balance panel and the
// existing bank-transfer payment-proof panel — mixed payment support (spec
// §30): whatever portion of the order the buyer doesn't cover via advance
// is what the bank-transfer screenshot amount reflects. The buyer's choice
// to use advance is never automatic; AdvanceUsagePanel's own default
// ("Use Advance Balance = No") is unaffected by this wrapper.
export default function OrderPaymentPanels({
  orderId,
  initialTotal,
  bank,
}: {
  orderId: string;
  initialTotal: number;
  bank: BankAccountDetails;
}) {
  const [outstanding, setOutstanding] = useState(initialTotal);

  return (
    <>
      <AdvanceUsagePanel orderId={orderId} onOutstandingChange={setOutstanding} />
      {outstanding > 0 ? (
        <BankTransferPaymentPanel orderId={orderId} amount={outstanding} bank={bank} />
      ) : (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-bold">Order Fully Paid</p>
          <p className="mt-1">This order's outstanding amount has been fully covered by your Buildohub Advance Balance.</p>
        </div>
      )}
    </>
  );
}
