"use client";

import { useEffect, useState } from "react";
import { builderApiGet, builderApiPost } from "@/lib/api";

type BankGuaranteeSummary = {
  enabled: boolean;
  status: string;
  amount: number | null;
  issuerName: string | null;
  validTill: string | null;
  docUrl: string | null;
  acceptedAt: string | null;
};

// UF-05: Credit / BNPL Activation — FR-20, FR-27, FR-28, FR-29
// REQ-09: Bank Guarantee registration, added to builder onboarding alongside
// the existing EMI/BNPL/Working Capital options below.
export default function CreditPage() {
  const [step, setStep] = useState<"options" | "consent" | "scoring" | "kfs" | "approved" | "bankGuarantee">("options");
  const [availableLimit, setAvailableLimit] = useState<number>(0);
  const [creditStatus, setCreditStatus] = useState<string>("NOT_APPLIED");

  const [bankGuarantee, setBankGuarantee] = useState<BankGuaranteeSummary | null>(null);
  const [bgIssuerName, setBgIssuerName] = useState("");
  const [bgAmount, setBgAmount] = useState("");
  const [bgValidTill, setBgValidTill] = useState("");
  const [bgSubmitting, setBgSubmitting] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCreditSummary() {
      try {
        const data = await builderApiGet<{ availableLimit: number; status: string; bankGuarantee: BankGuaranteeSummary }>("/credit");
        if (!active) return;
        setAvailableLimit(Number(data.availableLimit || 0));
        setCreditStatus(String(data.status || "NOT_APPLIED"));
        setBankGuarantee(data.bankGuarantee ?? null);
      } catch {
        if (!active) return;
        setAvailableLimit(0);
        setCreditStatus("NOT_APPLIED");
        setBankGuarantee(null);
      }
    }

    void loadCreditSummary();
    return () => {
      active = false;
    };
  }, []);

  async function submitBankGuarantee() {
    setBgError(null);
    const amountNum = Number(bgAmount);
    if (!bgIssuerName.trim() || !amountNum || amountNum <= 0) {
      setBgError("Please enter the issuing bank name and a valid guarantee amount.");
      return;
    }
    setBgSubmitting(true);
    try {
      const result = await builderApiPost<BankGuaranteeSummary>("/credit/bank-guarantee", {
        issuerName: bgIssuerName.trim(),
        amount: amountNum,
        validTill: bgValidTill || undefined,
      });
      setBankGuarantee(result);
      setStep("options");
    } catch {
      setBgError("Failed to submit Bank Guarantee registration. Please try again.");
    } finally {
      setBgSubmitting(false);
    }
  }


  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-slate-900">Credit & BNPL</h1>
      <p className="text-sm text-slate-500">Status: <span className="font-semibold text-slate-700">{creditStatus}</span> · Available: <span className="font-semibold text-slate-700">INR {availableLimit.toLocaleString("en-IN")}</span></p>

      {/* Step: select credit type */}
      {step === "options" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Choose the credit product that suits your needs.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { title: "EMI Financing", desc: "Split payments into monthly instalments", badge: "Could Have", icon: "📅" },
              { title: "BNPL 30/60/90", desc: "Receive materials now, pay later", badge: "Could Have", icon: "⏳" },
              { title: "Working Capital", desc: "Pre-approved credit line for procurement", badge: "Could Have", icon: "💰" },
            ].map(({ title, desc, badge, icon }) => (
              <button
                key={title}
                onClick={() => setStep("consent")}
                className="panel p-5 text-left hover:shadow-md hover:border-blue-700 transition-all"
              >
                <div className="text-2xl mb-2">{icon}</div>
                <div className="font-semibold text-sm text-slate-800">{title}</div>
                <div className="text-xs text-slate-400 mt-1">{desc}</div>
              </button>
            ))}

            {/* REQ-09: Bank Guarantee registration, part of builder onboarding */}
            <button
              onClick={() => setStep("bankGuarantee")}
              className="panel p-5 text-left hover:shadow-md hover:border-blue-700 transition-all"
            >
              <div className="text-2xl mb-2">🏦</div>
              <div className="font-semibold text-sm text-slate-800">Bank Guarantee</div>
              <div className="text-xs text-slate-400 mt-1">Register a bank guarantee to unlock the Bank Guarantee payment option at checkout</div>
              {bankGuarantee?.enabled ? (
                <div className="mt-2 inline-block bg-emerald-50 text-emerald-700 text-xs font-semibold px-2 py-0.5 rounded">
                  {bankGuarantee.status}
                </div>
              ) : null}
            </button>
          </div>
        </div>
      )}

      {/* Step: Bank Guarantee registration — REQ-09 */}
      {step === "bankGuarantee" && (
        <div className="panel p-6 space-y-4">
          <h2 className="font-semibold text-slate-800">Register Bank Guarantee</h2>
          <p className="text-sm text-slate-500">
            Submit your bank guarantee details below. Once verified, you&apos;ll be able to select
            &quot;Bank Guarantee&quot; as a payment method when checking out an order.
          </p>

          {bankGuarantee?.enabled ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              A bank guarantee is already registered (status: <strong>{bankGuarantee.status}</strong>) from{" "}
              <strong>{bankGuarantee.issuerName}</strong> for ₹{Number(bankGuarantee.amount ?? 0).toLocaleString("en-IN")}.
              Submitting again will update these details.
            </div>
          ) : null}

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Issuing Bank Name</label>
              <input
                type="text"
                value={bgIssuerName}
                onChange={(e) => setBgIssuerName(e.target.value)}
                placeholder="e.g. State Bank of India"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Guarantee Amount (INR)</label>
              <input
                type="number"
                min={1}
                value={bgAmount}
                onChange={(e) => setBgAmount(e.target.value)}
                placeholder="e.g. 500000"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Valid Till (optional)</label>
              <input
                type="date"
                value={bgValidTill}
                onChange={(e) => setBgValidTill(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {bgError ? <p className="text-xs text-rose-600">{bgError}</p> : null}

          <div className="flex gap-3">
            <button
              onClick={() => setStep("options")}
              className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm"
            >
              Back
            </button>
            <button
              onClick={submitBankGuarantee}
              disabled={bgSubmitting}
              className="flex-1 bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-60"
            >
              {bgSubmitting ? "Submitting..." : "Submit for Verification"}
            </button>
          </div>
        </div>
      )}


      {/* Step: consent — FR-29 */}
      {step === "consent" && (
        <div className="panel p-6 space-y-4">
          <h2 className="font-semibold text-slate-800">Data Access Consent</h2>
          <p className="text-sm text-slate-500">To score your creditworthiness, our NBFC partner needs access to your GST filing history and ITR data. This is a one-time consent.</p>
          <ul className="text-sm text-slate-500 list-disc list-inside space-y-1">
            <li>GST filing history (last 12 months)</li>
            <li>Income Tax Returns (last 2 years)</li>
          </ul>
          <div className="flex gap-3">
            <button onClick={() => setStep("options")} className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2.5 text-sm">Cancel</button>
            <button onClick={() => setStep("scoring")} className="flex-1 bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium">I Authorise Data Access</button>
          </div>
        </div>
      )}

      {/* Step: scoring in progress */}
      {step === "scoring" && (
        <div className="panel p-10 text-center space-y-4">
          <div className="w-12 h-12 border-4 border-blue-700 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-medium text-slate-800">Running credit assessment...</p>
          <p className="text-sm text-slate-400">Evaluating GST + ITR data via NBFC model. This takes ~30 seconds.</p>
          {/* Simulate completion */}
          <button onClick={() => setStep("kfs")} className="text-xs text-blue-700 hover:underline">
            (Demo: Continue to KFS →)
          </button>
        </div>
      )}

      {/* Step: RBI Key Fact Statement — FR-29 mandatory */}
      {step === "kfs" && (
        <div className="panel p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="bg-blue-50 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded">RBI Mandated</span>
            <h2 className="font-semibold text-slate-800">Key Fact Statement (KFS)</h2>
          </div>
          <div className="bg-slate-50 rounded-lg p-4 text-xs text-slate-600 space-y-2 max-h-48 overflow-y-auto">
            <p><strong>Lender:</strong> BuildMart NBFC Partner Pvt. Ltd.</p>
            <p><strong>Loan Type:</strong> Buy-Now-Pay-Later (BNPL)</p>
            <p><strong>Credit Limit:</strong> ₹5,00,000</p>
            <p><strong>Annual Percentage Rate (APR):</strong> 18% p.a.</p>
            <p><strong>Processing Fee:</strong> 1% of disbursed amount + GST</p>
            <p><strong>Repayment:</strong> 30, 60, or 90 days from order date</p>
            <p><strong>Penal Charges:</strong> 2% per month on overdue amount</p>
            <p><strong>Grievance Officer:</strong> grievance@matsrc.in</p>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-blue-700" />
            <span className="text-xs text-slate-500">I have read and accept the Key Fact Statement. I consent to the terms of this credit product.</span>
          </label>
          <button onClick={() => setStep("approved")} className="w-full bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium">
            Confirm with OTP & Activate Credit
          </button>
        </div>
      )}

      {/* Approved */}
      {step === "approved" && (
        <div className="panel p-10 text-center space-y-3">
          <div className="text-5xl">🎉</div>
          <h2 className="font-bold text-xl text-slate-800">Credit Activated!</h2>
          <p className="text-sm text-slate-500">Your credit limit of <strong>₹5,00,000</strong> is ready to use at checkout.</p>
          <p className="text-xs text-slate-400">Payment reminders will be sent 7 and 1 day before due date via WhatsApp & SMS.</p>
          <a href="/dashboard" className="inline-block mt-2 bg-blue-700 text-white rounded-lg px-6 py-2 text-sm font-medium">Go to Dashboard</a>
        </div>
      )}
    </div>
  );
}
