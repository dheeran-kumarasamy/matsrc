"use client";

import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { builderApiUpload } from "@/lib/api";
import { formatAmountIndian, getFormattedCursorIndex, stripAmountFormatting } from "@/lib/amount-input-format";

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

type SubmitResult = { id: string; referenceNumber: string; amount: number; status: string; submittedAt: string };

// Add Advance — buyer submission form (spec §12/§13). Reuses the EXACT SAME
// screenshot upload/validation UX as BankTransferPaymentPanel (order
// payment-proof flow) instead of introducing a second upload component.
//
// Amount input: `amount` always holds the RAW, unformatted numeric string
// (e.g. "100000") — it starts blank and is NEVER prefilled with a
// suggested/default/available-balance value. The input displays an
// Indian-style comma-grouped version of this raw value (formatAmountIndian)
// purely for presentation; every validation, submission and financial
// calculation below continues to use the raw `amount` string untouched.
// No preset/suggested-amount buttons (e.g. ₹5,000/₹10,000/₹25,000/₹50,000)
// are rendered below this field — manual entry only.
export default function AddAdvanceForm({ onSubmitted }: { onSubmitted: (result: SubmitResult) => void }) {
  const [amount, setAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<SubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);

  // Reformats whatever the user just typed/edited/pasted into the Indian
  // comma-grouped display, while keeping `amount` itself raw/clean and
  // restoring the caret to the equivalent position so editing digits in the
  // middle of the amount (or deleting/inserting) never jumps the cursor.
  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const rawCursor = input.selectionStart ?? input.value.length;
    const digitsBeforeCursor = input.value.slice(0, rawCursor).replace(/[^0-9.]/g, "").length;

    const nextRaw = stripAmountFormatting(input.value);
    setAmount(nextRaw);

    // Restore the caret after React re-renders with the newly formatted
    // display value.
    requestAnimationFrame(() => {
      const el = amountInputRef.current;
      if (!el) return;
      const formatted = formatAmountIndian(nextRaw);
      const nextCursor = getFormattedCursorIndex(digitsBeforeCursor, formatted);
      el.setSelectionRange(nextCursor, nextCursor);
    });
  }

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
          ref={amountInputRef}
          type="text"
          inputMode="decimal"
          value={formatAmountIndian(amount)}
          onChange={handleAmountChange}
          placeholder="Enter amount"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
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

