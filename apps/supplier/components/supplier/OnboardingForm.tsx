"use client";

import { useRef, useState, useTransition } from "react";
import { submitKycDocument } from "@/app/(supplier)/onboarding/actions";
import type { KycDocStatus } from "@/lib/supplier-data";

type Props = {
  docs: KycDocStatus[];
  kycStatus: "PENDING" | "APPROVED" | "REJECTED";
};

const statusColour = {
  PENDING: "bg-amber-50 text-amber-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
};

const statusLabel = {
  PENDING: "Pending Review",
  APPROVED: "KYC Approved",
  REJECTED: "KYC Rejected",
};

export function OnboardingForm({ docs, kycStatus }: Props) {
  const [result, setResult] = useState<Record<string, "ok" | "error" | null>>({});
  const [isPending, startTransition] = useTransition();
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function handleUpload(docType: string) {
    const input = fileRefs.current[docType];
    if (!input?.files?.length) return;

    const file = input.files[0];
    const fd = new FormData();
    fd.append("docType", docType);
    fd.append("file", file);

    startTransition(async () => {
      try {
        await submitKycDocument(fd);
        setResult((prev) => ({ ...prev, [docType]: "ok" }));
        input.value = "";
      } catch {
        setResult((prev) => ({ ...prev, [docType]: "error" }));
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Overall KYC status */}
      <div className="panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-extrabold text-slate-900">Supplier Onboarding</h3>
            <p className="mt-1 text-sm text-slate-600">
              Upload the required documents below. Our team reviews submissions within 2 business days.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusColour[kycStatus]}`}>
            {statusLabel[kycStatus]}
          </span>
        </div>
      </div>

      {/* Document upload cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {docs.map((doc) => {
          const uploaded = !!doc.fileUrl;
          const feedback = result[doc.type];

          return (
            <article key={doc.type} className="panel p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-bold text-slate-900">
                    {doc.label}
                    {doc.required && <span className="ml-1 text-red-500">*</span>}
                  </h4>
                  {uploaded ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {doc.verified ? "✅ Verified" : "⏳ Submitted — awaiting review"}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-slate-500">Not yet submitted</p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                    doc.verified
                      ? "bg-emerald-50 text-emerald-700"
                      : uploaded
                      ? "bg-blue-50 text-blue-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {doc.verified ? "Verified" : uploaded ? "In Review" : "Required"}
                </span>
              </div>

              {!doc.verified && (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    ref={(el) => { fileRefs.current[doc.type] = el; }}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="flex-1 text-xs file:mr-2 file:rounded file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-blue-700"
                  />
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleUpload(doc.type)}
                    className="shrink-0 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {isPending ? "…" : uploaded ? "Replace" : "Upload"}
                  </button>
                </div>
              )}

              {feedback === "ok" && (
                <p className="mt-2 text-xs font-semibold text-emerald-600">
                  Document submitted successfully. Refresh to see status.
                </p>
              )}
              {feedback === "error" && (
                <p className="mt-2 text-xs font-semibold text-red-600">Upload failed. Please try again.</p>
              )}
            </article>
          );
        })}
      </div>

      {/* Checklist summary */}
      <div className="panel p-4">
        <h4 className="font-bold text-slate-900">What happens next?</h4>
        <ol className="mt-2 space-y-1 text-sm text-slate-600 list-decimal list-inside">
          <li>Upload all required documents above</li>
          <li>BuildMart team reviews within 2 business days</li>
          <li>BIS licence validation runs against the government database</li>
          <li>Account activated — you'll receive a confirmation email</li>
        </ol>
      </div>
    </div>
  );
}
