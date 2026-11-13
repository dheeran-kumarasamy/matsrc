"use client";

import { useEffect, useState } from "react";

type InvoiceStatusResponse =
  | { exists: false }
  | {
      exists: true;
      status: "PENDING_REVIEW" | "REJECTED" | "CONFIRMED";
      fileName: string;
      size: number;
      uploadedAt: string;
      supplierInvoiceNumber: string | null;
      supplierInvoiceDate: string | null;
      rejectionReason: string | null;
      confirmedAt: string | null;
    };

const STATUS_LABEL: Record<"PENDING_REVIEW" | "REJECTED" | "CONFIRMED", string> = {
  PENDING_REVIEW: "Awaiting Admin Review",
  REJECTED: "Rejected — please re-upload",
  CONFIRMED: "Confirmed",
};

const STATUS_BADGE: Record<"PENDING_REVIEW" | "REJECTED" | "CONFIRMED", string> = {
  PENDING_REVIEW: "bg-amber-50 text-amber-700",
  REJECTED: "bg-rose-50 text-rose-700",
  CONFIRMED: "bg-emerald-50 text-emerald-700",
};

// Supplier-side upload of the supplier's OWN invoice document for this
// order — the first step of the Supplier Invoice Upload / Admin
// Verification / Buyer Invoice Generation workflow. The upload alone never
// generates a BuildOhub buyer invoice; it only creates/resets a
// SupplierInvoice row awaiting Admin review. A REJECTED invoice can be
// re-uploaded in place; a CONFIRMED invoice can never be replaced here.
export function SupplierInvoiceUpload({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<InvoiceStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [orderId]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/supplier/orders/${orderId}/invoice`, { cache: "no-store" });
      const data = (await res.json()) as InvoiceStatusResponse;
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  async function upload() {
    if (!file) {
      setError("Please choose an invoice file to upload");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      if (supplierInvoiceNumber.trim()) form.set("supplierInvoiceNumber", supplierInvoiceNumber.trim());
      if (supplierInvoiceDate) form.set("supplierInvoiceDate", supplierInvoiceDate);

      const res = await fetch(`/api/supplier/orders/${orderId}/invoice`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to upload invoice");
      }
      setFile(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload invoice");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return null;
  }

  const canUpload = !status?.exists || status.status === "REJECTED";

  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-4">
      <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">Invoice</h4>

      {status?.exists ? (
        <div className="mt-2">
          <span className={`rounded-full px-2 py-1 text-xs font-bold ${STATUS_BADGE[status.status]}`}>
            {STATUS_LABEL[status.status]}
          </span>
          <p className="mt-2 text-xs text-slate-500">
            {status.fileName} · Uploaded {new Date(status.uploadedAt).toLocaleString("en-IN")}
          </p>
          {status.status === "REJECTED" && status.rejectionReason ? (
            <p className="mt-1 text-xs italic text-rose-700">Reason: {status.rejectionReason}</p>
          ) : null}
          <a
            href={`/api/supplier/orders/${orderId}/invoice/download`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
          >
            View Uploaded Invoice
          </a>
        </div>
      ) : (
        <p className="mt-1 text-sm text-slate-500">No invoice uploaded yet for this order.</p>
      )}

      {canUpload ? (
        <div className="mt-3 space-y-2">
          {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
              placeholder="Your invoice number (optional)"
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
            <input
              type="date"
              value={supplierInvoiceDate}
              onChange={(e) => setSupplierInvoiceDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <button
            disabled={uploading}
            onClick={() => void upload()}
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {uploading ? "Uploading…" : status?.exists ? "Re-upload Invoice" : "Upload Invoice"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
