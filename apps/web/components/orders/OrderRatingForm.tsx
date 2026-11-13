"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { builderApiGet, builderApiPost, builderApiUpload } from "@/lib/api";

type Props = {
  orderId: string;
};

const ALLOWED_RECEIPT_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
const MAX_RECEIPT_SIZE_BYTES = 5 * 1024 * 1024;

type ReceiptUploadState = "idle" | "uploading" | "success" | "error";

type ReceiptMetadata = {
  exists: boolean;
  fileName: string | null;
};

export default function OrderRatingForm({ orderId }: Props) {
  const [deliveryRating, setDeliveryRating] = useState(5);
  const [qualityRating, setQualityRating] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Receipt upload is entirely independent of rating-save success/failure —
  // selecting/uploading a file never blocks or reverts the rating itself.
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptState, setReceiptState] = useState<ReceiptUploadState>("idle");
  const [uploadedReceiptName, setUploadedReceiptName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // A previously uploaded receipt (from an earlier visit/session) — fetched
  // from the existing metadata-only GET endpoint, which never returns raw
  // bytes. Lets the form show a "View/Download Receipt" link even after a
  // page reload, without re-selecting/re-uploading a file.
  const [existingReceipt, setExistingReceipt] = useState<ReceiptMetadata | null>(null);

  useEffect(() => {
    let cancelled = false;
    builderApiGet<ReceiptMetadata>(`/orders/${orderId}/rating/receipt`)
      .then((data) => {
        if (!cancelled) setExistingReceipt(data);
      })
      .catch(() => {
        // No rating/receipt yet, or not authorized — simply don't show the
        // existing-receipt link; never surfaced as a page-level error.
        if (!cancelled) setExistingReceipt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  function validateAndSetReceipt(selected: File | null) {
    setReceiptError(null);
    setReceiptState("idle");
    if (!selected) {
      setReceiptFile(null);
      return;
    }
    if (!ALLOWED_RECEIPT_TYPES.includes(selected.type)) {
      setReceiptError("Only JPG, JPEG, PNG or PDF files are allowed");
      return;
    }
    if (selected.size > MAX_RECEIPT_SIZE_BYTES) {
      setReceiptError("File must be 5 MB or smaller");
      return;
    }
    setReceiptFile(selected);
  }

  function removeReceipt() {
    setReceiptFile(null);
    setReceiptError(null);
    setReceiptState("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadReceipt() {
    if (!receiptFile) return;
    setReceiptState("uploading");
    setReceiptError(null);
    try {
      const formData = new FormData();
      formData.append("file", receiptFile);
      const result = await builderApiUpload<{ fileName: string }>(`/orders/${orderId}/rating/receipt`, formData);
      setUploadedReceiptName(result.fileName);
      setExistingReceipt({ exists: true, fileName: result.fileName });
      setReceiptState("success");
    } catch {
      // Rating save (if any) already succeeded independently — only the
      // receipt step failed. Preserve the selected file so the user can
      // retry without re-selecting it.
      setReceiptError("Unable to upload receipt right now. You can retry below.");
      setReceiptState("error");
    }
  }

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      await builderApiPost(`/orders/${orderId}/rating`, {
        deliveryRating,
        qualityRating,
        comment: comment.trim() || undefined,
      });
      setSaved(true);

      // Submit the rating first; only if that succeeds do we attempt the
      // optional receipt upload, and its outcome is shown independently —
      // never silently marked as uploaded before the server confirms it.
      if (receiptFile) {
        await uploadReceipt();
      }
    } catch {
      setError("Unable to save rating right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel p-5 space-y-3">
      <h2 className="text-lg font-semibold text-slate-800">Rate supplier delivery and quality</h2>
      <p className="text-sm text-slate-500">Submit feedback for this delivered order. You can edit within 72 hours.</p>

      <label className="block text-sm text-slate-700">
        Delivery rating
        <select
          value={deliveryRating}
          onChange={(event) => setDeliveryRating(Number(event.target.value))}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
        >
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-slate-700">
        Product quality rating
        <select
          value={qualityRating}
          onChange={(event) => setQualityRating(Number(event.target.value))}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
        >
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-slate-700">
        Comment (optional)
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
          placeholder="How was delivery and product quality?"
        />
      </label>

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Receipt copy (optional)</p>
        <p className="text-xs text-slate-500">Accepted formats: JPG, PNG or PDF. Max size 5 MB.</p>

        {existingReceipt?.exists && !receiptFile ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <span className="truncate text-emerald-800">{existingReceipt.fileName}</span>
            <a
              href={`/api/builder/orders/${orderId}/rating/receipt/download`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              View/Download
            </a>
          </div>
        ) : null}

        {!receiptFile ? (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 hover:border-slate-400">
            <Upload className="h-5 w-5" />
            <span>Click to select a receipt (JPG, PNG or PDF, max 5 MB)</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,application/pdf"
              className="hidden"
              onChange={(event) => validateAndSetReceipt(event.target.files?.[0] ?? null)}
            />
          </label>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span className="truncate text-slate-700">{receiptFile.name}</span>
            <button
              type="button"
              onClick={removeReceipt}
              aria-label="Remove selected receipt"
              disabled={receiptState === "uploading"}
              className="shrink-0 rounded-full p-1 text-slate-500 hover:text-slate-800 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {receiptError ? <p className="text-xs text-red-600">{receiptError}</p> : null}
        {receiptState === "uploading" ? <p className="text-xs text-slate-500">Uploading receipt…</p> : null}
        {receiptState === "success" && uploadedReceiptName ? (
          <p className="text-xs text-emerald-600">Receipt uploaded successfully.</p>
        ) : null}
        {receiptState === "error" ? (
          <button
            type="button"
            onClick={() => void uploadReceipt()}
            className="text-xs font-semibold text-[color:var(--posh-primary)] underline"
          >
            Retry receipt upload
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={loading || (saved && receiptState !== "error")}
        className="posh-btn-solid w-full rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
      >
        {saved ? (loading ? "Uploading receipt..." : "Rating saved") : loading ? "Saving..." : "Submit rating"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
