"use client";

import { useState } from "react";
import ConfirmDeliveryModal from "./ConfirmDeliveryModal";

interface ConfirmDeliveryCardProps {
  orderId: string;
  orderNumber?: string | null;
  buyerName?: string;
}

export default function ConfirmDeliveryCard({
  orderId,
  orderNumber,
  buyerName,
}: ConfirmDeliveryCardProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div
        className="rounded-2xl border p-5 shadow-sm transition-all animate-in fade-in"
        style={{
          borderColor: "var(--posh-border)",
          background: "linear-gradient(to bottom right, rgba(16, 185, 129, 0.08), rgba(var(--posh-wash-rgb), 0.03))",
        }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  Material In Transit
                </span>
                <span className="text-xs text-slate-500">Ready for Site Verification</span>
              </div>
              <h3 className="mt-1 text-base font-extrabold text-slate-900 dark:text-slate-100">
                Materials Dispatched to Site
              </h3>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                The supplier has dispatched the consignment. Once the vehicle arrives and materials are inspected against the Delivery Challan, please confirm receipt below.
              </p>
            </div>
          </div>

          <div className="shrink-0 sm:self-center">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700 active:scale-95 sm:w-auto"
            >
              Confirm Material Receipt
            </button>
          </div>
        </div>
      </div>

      <ConfirmDeliveryModal
        orderId={orderId}
        orderNumber={orderNumber}
        initialReceiverName={buyerName}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}

