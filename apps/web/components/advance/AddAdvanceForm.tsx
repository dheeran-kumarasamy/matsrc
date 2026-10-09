"use client";

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { builderApiUpload } from "@/lib/api";

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const PREDEFINED_AMOUNTS = [5000, 10000, 25000, 50000];

type SubmitResult = { id: string; referenceNumber: string; amount: number; status: string; submittedAt: string };

// Add Advance — buyer submission form (spec §12/§13). Reuses the EXACT SAME
// screenshot upload/validation UX as BankTransferPaymentPanel (order
// payment-proof flow) instead of introducing a second upload component.
export default function AddAdvanceForm({ onSubmitted }: { onSubmitted: (result: SubmitResult) => void }) {
  const [amount, setAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<SubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function validateAndSetFile(selected: File | null) {
    setError(null);
    if (!selected) {
      setFile(null);
      setPreview(null);
      return;
    }
    if (!ALLOWED_TYPES.includes(selected.type)) {
      setError("Only JPG, JPEG or PNG files are allowed");
      return;
    }
    if (selected.size > MAX_SIZE_BYTES) {
      setError("File must be 5 MB or smaller");
      return;
    }
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }

  function removeFile() {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit() {
    setError(null);
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Enter a valid advance amount");
      return;
    }
    if (!paymentReference.trim()) {
      setError("Payment reference / UTR is required");
      return;
    }
    if (!file) {
      setError("Please select a payment screenshot to upload");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("amount", String(amountNum));
      formData.append("paymentReference", paymentReference.trim());
      formData.append("file", file);
      const result = await builderApiUpload<SubmitResult>("/advance/payments", formData);
      setConfirmation(result);
      onSubmitted(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit advance payment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
        <p className="font-bold">Advance Payment Submitted</p>
        <p className="mt-2">
          Reference: <span className="font-semibold">{confirmation.referenceNumber}</span>
        </p>
        <p className="mt-1">Amount: ₹{confirmation.amount.toLocaleString("en-IN")}</p>
        <p className="mt-1">Status: Pending Verification</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4 border-t border-[color:var(--posh-border)] pt-4">
      <div>
        <p className="posh-label mb-2">Amount</p>
        <input
          type="number"
          min={1}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Enter amount"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {PREDEFINED_AMOUNTS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setAmount(String(preset))}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-400"
            >
              ₹{preset.toLocaleString("en-IN")}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="posh-label mb-2">Payment Method</p>
        <p className="text-sm text-slate-600">Manual Payment (Bank Transfer / UPI)</p>
      </div>

      <div>
        <p className="posh-label mb-2">Payment Reference / UTR</p>
        <input
          type="text"
          value={paymentReference}
          onChange={(e) => setPaymentReference(e.target.value)}
          placeholder="Enter UTR / reference number"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-3">
        <p className="posh-label">Payment Screenshot</p>
        {!preview ? (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[color:var(--posh-border)] px-4 py-8 text-center text-sm text-[color:var(--posh-fg-muted)] hover:border-[color:var(--posh-primary)]">
            <Upload className="h-5 w-5" />
            <span>Click to select a JPG, JPEG or PNG screenshot (max 5 MB)</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png"
              className="hidden"
              onChange={(e) => validateAndSetFile(e.target.files?.[0] ?? null)}
            />
          </label>
        ) : (
          <div className="relative w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Payment screenshot preview" className="max-h-64 rounded-xl border border-[color:var(--posh-border)]" />
            <button
              type="button"
              onClick={removeFile}
              aria-label="Remove selected screenshot"
              className="absolute -right-2 -top-2 rounded-full bg-[color:var(--posh-fg)] p-1 text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="posh-btn-solid rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit Payment"}
      </button>
    </div>
  );
}

