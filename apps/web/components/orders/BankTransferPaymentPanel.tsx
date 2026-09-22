"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check, Upload, X } from "lucide-react";
import { builderApiGet, builderApiUpload } from "@/lib/api";
import type { BankAccountDetails } from "@/lib/bank-account-config";

type ProofStatus = {
  exists: boolean;
  status?: "PENDING" | "APPROVED" | "REJECTED";
  fileName?: string;
  submittedAt?: string;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
};

type Props = {
  orderId: string;
  amount: number;
  bank: BankAccountDetails;
};

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — silently ignore, value is still visible/selectable.
    }
  }

  return (
    <div className="rounded-xl border border-[color:var(--posh-border)] bg-[rgba(var(--posh-wash-rgb),0.03)] px-4 py-3">
      <p className="posh-label">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="font-bold text-[color:var(--posh-fg)] break-all">{value}</p>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          className="shrink-0 rounded-lg border border-[color:var(--posh-border)] p-1.5 text-[color:var(--posh-fg-muted)] hover:text-[color:var(--posh-fg)]"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export default function BankTransferPaymentPanel({ orderId, amount, bank }: Props) {
  const [proof, setProof] = useState<ProofStatus | null>(null);
  const [loadingProof, setLoadingProof] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingProof(true);
    builderApiGet<ProofStatus>(`/orders/${orderId}/payment-proof`)
      .then((data) => {
        if (!cancelled) setProof(data);
      })
      .catch(() => {
        if (!cancelled) setProof({ exists: false });
      })
      .finally(() => {
        if (!cancelled) setLoadingProof(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

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
    if (!file) {
      setError("Please select a payment screenshot to upload");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await builderApiUpload(`/orders/${orderId}/payment-proof`, formData);
      setProof({ exists: true, status: "PENDING", submittedAt: new Date().toISOString() });
      removeFile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit payment proof. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const canUpload = !loadingProof && (!proof?.exists || proof.status === "REJECTED");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[color:var(--posh-primary)] bg-[rgba(var(--posh-wash-rgb),0.04)] px-4 py-3">
        <p className="posh-label">Amount to Pay</p>
        <p className="mt-1 text-2xl font-extrabold text-[color:var(--posh-fg)]">₹{amount.toLocaleString("en-IN")}</p>
      </div>

      <div>
        <p className="posh-label mb-2">Bank Account Details</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label="Account Holder" value={bank.accountHolderName} />
          <CopyField label="Bank" value={bank.bankName} />
          <CopyField label="Account Number" value={bank.accountNumber} />
          <CopyField label="IFSC" value={bank.ifscCode} />
          <CopyField label="Branch" value={bank.branch} />
          {bank.upiId ? <CopyField label="UPI ID" value={bank.upiId} /> : null}
          <CopyField label="Order Reference" value={orderId} />
        </div>
      </div>

      <p className="text-sm text-[color:var(--posh-fg-muted)]">
        Make the bank transfer using the account details above. After completing the transfer, upload the payment
        screenshot below. Your payment will be reviewed and verified by our admin team before your order is confirmed
        and sent for supplier processing.
      </p>

      {loadingProof ? (
        <p className="text-sm text-[color:var(--posh-fg-muted)]">Checking payment status…</p>
      ) : proof?.exists && proof.status === "PENDING" ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-bold">Payment Verification Pending</p>
          <p className="mt-1">
            Your payment screenshot has been submitted successfully. Our team will verify your payment before your
            order is confirmed for supplier processing.
          </p>
        </div>
      ) : proof?.exists && proof.status === "APPROVED" ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-bold">Payment Verified</p>
          <p className="mt-1">Your payment has been verified and your order is being processed.</p>
        </div>
      ) : null}

      {proof?.exists && proof.status === "REJECTED" ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <p className="font-bold">Payment Verification Failed</p>
          <p className="mt-1">
            We could not verify this payment proof. Please review the reason and upload a valid payment screenshot.
          </p>
          {proof.rejectionReason ? <p className="mt-1 italic">Reason: {proof.rejectionReason}</p> : null}
        </div>
      ) : null}

      {canUpload ? (
        <div className="space-y-3">
          <p className="posh-label">Upload Payment Screenshot</p>
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

          {error ? <p className="text-xs text-rose-600">{error}</p> : null}

          <button
            type="button"
            onClick={submit}
            disabled={!file || submitting}
            className="posh-btn-solid rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Payment for Verification"}
          </button>
        </div>
      ) : null}
    </div>
  );
}