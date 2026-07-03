"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitKycDocument, saveBusinessInfo, submitOnboarding } from "@/app/(supplier)/onboarding/actions";
import { validatePhoneFormat, getPhoneErrorMessage } from "@/lib/phone-validator";
import type { KycDocStatus } from "@/lib/supplier-data";

type BusinessInfo = {
  companyName: string;
  contactName: string;
  phone: string;
  whatsappNumber: string;
  bisLicenceNo: string;
};

type InitialData = BusinessInfo & {
  kycStatus: "PENDING" | "APPROVED" | "REJECTED";
  docs: KycDocStatus[];
};

type Props = { initial: InitialData };

const STEPS = ["Business Details", "KYC Documents", "Review & Submit"];

function deriveInitialStep(d: InitialData): number {
  const step1Done =
    d.companyName.trim() &&
    d.companyName !== "New Supplier" &&
    d.phone.trim();
  if (!step1Done) return 0;
  const requiredDocs = d.docs.filter((doc) => doc.required);
  const step2Done = requiredDocs.every((doc) => !!doc.fileUrl);
  if (!step2Done) return 1;
  return 2;
}

const INPUT_CLS =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export function OnboardingForm({ initial }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(() => deriveInitialStep(initial));
  const [showRejectedNotice, setShowRejectedNotice] = useState(initial.kycStatus === "REJECTED");
  const [docs, setDocs] = useState<KycDocStatus[]>(initial.docs);
  const [uploadedDocTypes, setUploadedDocTypes] = useState<Set<string>>(
    () =>
      new Set(
        initial.docs.filter((d) => d.verified || !!d.fileUrl).map((d) => d.type)
      )
  );
  const [bizInfo, setBizInfo] = useState<BusinessInfo>({
    companyName: initial.companyName === "New Supplier" ? "" : initial.companyName,
    contactName: initial.contactName,
    phone: initial.phone,
    whatsappNumber: initial.whatsappNumber,
    bisLicenceNo: initial.bisLicenceNo,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [docFeedback, setDocFeedback] = useState<Record<string, "ok" | "error" | null>>({});
  const [submitError, setSubmitError] = useState("");
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function handleBizChange(e: React.ChangeEvent<HTMLInputElement>) {
    setErrors((prev) => ({ ...prev, [e.target.name]: "" }));
    setBizInfo((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function submitStep1() {
    const errs: Record<string, string> = {};
    if (!bizInfo.companyName.trim()) errs.companyName = "Required";
    if (!bizInfo.contactName.trim()) errs.contactName = "Required";
    if (!bizInfo.phone.trim()) {
      errs.phone = "Required";
    } else if (!validatePhoneFormat(bizInfo.phone)) {
      errs.phone = "Invalid phone number format";
    }
    
    // Validate WhatsApp number if provided
    if (bizInfo.whatsappNumber?.trim() && !validatePhoneFormat(bizInfo.whatsappNumber)) {
      errs.whatsappNumber = "Invalid WhatsApp number format";
    }
    
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    startTransition(async () => {
      await saveBusinessInfo(bizInfo);
      setStep(1);
    });
  }

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
        setDocs((prev) =>
          prev.map((d) =>
            d.type === docType
              ? { ...d, fileUrl: `uploaded:${file.name}`, submittedAt: new Date().toISOString() }
              : d
          )
        );
        setUploadedDocTypes((prev) => {
          const next = new Set(prev);
          next.add(docType);
          return next;
        });
        setDocFeedback((prev) => ({ ...prev, [docType]: "ok" }));
        if (input) input.value = "";
      } catch {
        setDocFeedback((prev) => ({ ...prev, [docType]: "error" }));
      }
    });
  }

  function submitForAdminReview() {
    setSubmitError("");

    startTransition(async () => {
      try {
        await submitOnboarding();
        router.push("/dashboard?onboarding=submitted");
      } catch (error) {
        setSubmitError(
          error instanceof Error ? error.message : "Unable to submit onboarding. Please try again."
        );
      }
    });
  }

  const requiredDocsUploaded = docs
    .filter((d) => d.required)
    .every((d) => d.verified || !!d.fileUrl || uploadedDocTypes.has(d.type));

  // ── Approved / Rejected shortcircuit ────────────────────────────────────
  if (initial.kycStatus === "APPROVED") {
    return (
      <div className="panel p-10 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h3 className="text-2xl font-extrabold text-emerald-700">KYC Approved!</h3>
        <p className="mt-2 text-sm text-slate-600">
          Your account is fully verified. You can now create listings and receive purchase orders.
        </p>
        <button
          onClick={() => router.push("/dashboard")}
          className="mt-6 rounded-lg bg-blue-700 px-6 py-2.5 text-sm font-bold text-white"
        >
          Go to Dashboard →
        </button>
      </div>
    );
  }

  if (showRejectedNotice) {
    return (
      <div className="panel p-10 text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h3 className="text-2xl font-extrabold text-red-600">KYC Not Approved</h3>
        <p className="mt-2 text-sm text-slate-600">
          One or more documents could not be verified. Please re-upload corrected documents below and resubmit.
        </p>
        <button
          onClick={() => {
            setShowRejectedNotice(false);
            setStep(1);
          }}
          className="mt-6 rounded-lg bg-blue-700 px-6 py-2.5 text-sm font-bold text-white"
        >
          Continue Setup
        </button>
      </div>
    );
  }

  // ── Wizard ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header + step indicator */}
      <div className="panel p-5">
        <h3 className="text-2xl font-extrabold text-slate-900">Supplier Onboarding</h3>
        <p className="mt-1 text-sm text-slate-600">
          Complete all steps to activate your supplier account.
        </p>

        <div className="mt-5 flex items-center">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center flex-1">
              <div className="flex flex-col items-center min-w-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 shrink-0 ${
                    i < step
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : i === step
                      ? "bg-blue-700 border-blue-700 text-white"
                      : "bg-white border-slate-300 text-slate-400"
                  }`}
                >
                  {i < step ? "✓" : i + 1}
                </div>
                <span
                  className={`mt-1 text-xs font-semibold text-center hidden sm:block ${
                    i === step
                      ? "text-blue-700"
                      : i < step
                      ? "text-emerald-600"
                      : "text-slate-400"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 mb-3 sm:mb-5 ${
                    i < step ? "bg-emerald-400" : "bg-slate-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Step 1: Business Details ─────────────────────────────────────── */}
      {step === 0 && (
        <div className="panel p-6 space-y-5">
          <div>
            <h4 className="text-lg font-bold text-slate-900">Business Details</h4>
            <p className="text-sm text-slate-500">Tell us about your company and primary contact person.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600">
                Company Name <span className="text-red-500">*</span>
              </label>
              <input
                name="companyName"
                value={bizInfo.companyName}
                onChange={handleBizChange}
                placeholder="e.g. BuildMart Steels Pvt Ltd"
                className={INPUT_CLS}
              />
              {errors.companyName && <p className="text-xs text-red-600">{errors.companyName}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600">
                Contact Person <span className="text-red-500">*</span>
              </label>
              <input
                name="contactName"
                value={bizInfo.contactName}
                onChange={handleBizChange}
                placeholder="Authorized signatory full name"
                className={INPUT_CLS}
              />
              {errors.contactName && <p className="text-xs text-red-600">{errors.contactName}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600">
                Phone Number <span className="text-red-500">*</span>
              </label>
              <input
                name="phone"
                value={bizInfo.phone}
                onChange={handleBizChange}
                placeholder="+91 98765 43210"
                className={INPUT_CLS}
              />
              {errors.phone && <p className="text-xs text-red-600">{errors.phone}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600">WhatsApp Number</label>
              <input
                name="whatsappNumber"
                value={bizInfo.whatsappNumber}
                onChange={handleBizChange}
                placeholder="Same as phone if identical"
                className={INPUT_CLS}
              />
              {errors.whatsappNumber && <p className="text-xs text-red-600">{errors.whatsappNumber}</p>}
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-600">BIS Licence Number (if available)</label>
              <input
                name="bisLicenceNo"
                value={bizInfo.bisLicenceNo}
                onChange={handleBizChange}
                placeholder="e.g. CM/L-12345678"
                className={INPUT_CLS}
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={submitStep1}
              disabled={isPending}
              className="rounded-lg bg-blue-700 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save & Continue →"}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: KYC Documents ────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-3">
          <div className="panel p-5">
            <h4 className="text-lg font-bold text-slate-900">KYC Documents</h4>
            <p className="text-sm text-slate-500 mt-1">
              Upload the required documents. Accepted formats: PDF, JPG, PNG.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {docs.map((doc) => {
              const uploaded = doc.verified || !!doc.fileUrl || uploadedDocTypes.has(doc.type);
              const feedback = docFeedback[doc.type];
              return (
                <article key={doc.type} className="panel p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h5 className="font-bold text-slate-900">
                        {doc.label}
                        {doc.required && <span className="ml-1 text-red-500">*</span>}
                      </h5>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {doc.verified
                          ? "✅ Verified by BuildMart"
                          : uploaded
                          ? "⏳ Submitted — awaiting review"
                          : "Not yet submitted"}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                        doc.verified
                          ? "bg-emerald-50 text-emerald-700"
                          : uploaded
                          ? "bg-blue-50 text-blue-700"
                          : doc.required
                          ? "bg-red-50 text-red-600"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {doc.verified ? "Verified" : uploaded ? "In Review" : doc.required ? "Required" : "Optional"}
                    </span>
                  </div>

                  {!doc.verified && (
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        ref={(el) => {
                          fileRefs.current[doc.type] = el;
                        }}
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
                    <p className="mt-2 text-xs font-semibold text-emerald-600">Uploaded successfully.</p>
                  )}
                  {feedback === "error" && (
                    <p className="mt-2 text-xs font-semibold text-red-600">Upload failed. Please try again.</p>
                  )}
                </article>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              ← Back
            </button>
            <div className="flex flex-col items-end gap-1">
              {!requiredDocsUploaded && (
                <p className="text-xs text-slate-500">Upload all required (*) documents to continue.</p>
              )}
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!requiredDocsUploaded}
                className="rounded-lg bg-blue-700 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Review & Submit ──────────────────────────────────────── */}
      {step === 2 && (
        <div className="panel p-6 space-y-5">
          <div>
            <h4 className="text-lg font-bold text-slate-900">Review & Submit</h4>
            <p className="text-sm text-slate-500">Confirm your details before we send them for admin review.</p>
          </div>

          <div className="divide-y divide-slate-100">
            <div className="pb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Business Details</p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">Company</dt>
                  <dd className="font-semibold">{bizInfo.companyName || initial.companyName}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Contact Person</dt>
                  <dd className="font-semibold">{bizInfo.contactName || initial.contactName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Phone</dt>
                  <dd className="font-semibold">{bizInfo.phone || initial.phone || "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">WhatsApp</dt>
                  <dd className="font-semibold">{bizInfo.whatsappNumber || initial.whatsappNumber || "—"}</dd>
                </div>
                {(bizInfo.bisLicenceNo || initial.bisLicenceNo) && (
                  <div className="col-span-2">
                    <dt className="text-slate-500">BIS Licence</dt>
                    <dd className="font-semibold">{bizInfo.bisLicenceNo || initial.bisLicenceNo}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">KYC Documents</p>
              <div className="space-y-1.5">
                {docs.map((d) => (
                  <div key={d.type} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">
                      {d.label}
                      {d.required ? " *" : ""}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        d.verified
                          ? "text-emerald-600"
                          : d.fileUrl
                          ? "text-blue-600"
                          : "text-slate-400"
                      }`}
                    >
                      {d.verified ? "✅ Verified" : d.fileUrl ? "⏳ In Review" : "Not uploaded"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
            <p className="text-xs text-amber-700">
              <strong>What happens next:</strong> Your submission is routed to the admin portal for manual KYC
              approval. BuildMart's compliance team will review your documents within 2 business days. You'll
              receive a confirmation email once approved.
            </p>
          </div>

          {submitError && <p className="text-sm font-semibold text-red-600">{submitError}</p>}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={submitForAdminReview}
              disabled={isPending || !requiredDocsUploaded}
              className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Submitting..." : "Submit for Admin Review"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
