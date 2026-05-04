"use client";

import { useState } from "react";

// UF-05: Credit / BNPL Activation — FR-20, FR-27, FR-28, FR-29
export default function CreditPage() {
  const [step, setStep] = useState<"options" | "consent" | "scoring" | "kfs" | "approved">("options");

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-gray-900">Credit & BNPL</h1>

      {/* Step: select credit type */}
      {step === "options" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Choose the credit product that suits your needs.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { title: "EMI Financing", desc: "Split payments into monthly instalments", badge: "Could Have", icon: "📅" },
              { title: "BNPL 30/60/90", desc: "Receive materials now, pay later", badge: "Could Have", icon: "⏳" },
              { title: "Working Capital", desc: "Pre-approved credit line for procurement", badge: "Could Have", icon: "💰" },
            ].map(({ title, desc, badge, icon }) => (
              <button
                key={title}
                onClick={() => setStep("consent")}
                className="bg-white border border-gray-100 rounded-xl p-5 text-left hover:shadow-md hover:border-brand-500 transition-all"
              >
                <div className="text-2xl mb-2">{icon}</div>
                <div className="font-semibold text-sm text-gray-800">{title}</div>
                <div className="text-xs text-gray-400 mt-1">{desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step: consent — FR-29 */}
      {step === "consent" && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">Data Access Consent</h2>
          <p className="text-sm text-gray-500">To score your creditworthiness, our NBFC partner needs access to your GST filing history and ITR data. This is a one-time consent.</p>
          <ul className="text-sm text-gray-500 list-disc list-inside space-y-1">
            <li>GST filing history (last 12 months)</li>
            <li>Income Tax Returns (last 2 years)</li>
          </ul>
          <div className="flex gap-3">
            <button onClick={() => setStep("options")} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm">Cancel</button>
            <button onClick={() => setStep("scoring")} className="flex-1 bg-brand-500 text-white rounded-lg py-2.5 text-sm font-medium">I Authorise Data Access</button>
          </div>
        </div>
      )}

      {/* Step: scoring in progress */}
      {step === "scoring" && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center space-y-4">
          <div className="w-12 h-12 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-medium text-gray-800">Running credit assessment...</p>
          <p className="text-sm text-gray-400">Evaluating GST + ITR data via NBFC model. This takes ~30 seconds.</p>
          {/* Simulate completion */}
          <button onClick={() => setStep("kfs")} className="text-xs text-brand-500 hover:underline">
            (Demo: Continue to KFS →)
          </button>
        </div>
      )}

      {/* Step: RBI Key Fact Statement — FR-29 mandatory */}
      {step === "kfs" && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="bg-blue-50 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded">RBI Mandated</span>
            <h2 className="font-semibold text-gray-800">Key Fact Statement (KFS)</h2>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-600 space-y-2 max-h-48 overflow-y-auto">
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
            <input type="checkbox" className="mt-0.5 accent-brand-500" />
            <span className="text-xs text-gray-500">I have read and accept the Key Fact Statement. I consent to the terms of this credit product.</span>
          </label>
          <button onClick={() => setStep("approved")} className="w-full bg-brand-500 text-white rounded-lg py-2.5 text-sm font-medium">
            Confirm with OTP & Activate Credit
          </button>
        </div>
      )}

      {/* Approved */}
      {step === "approved" && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center space-y-3">
          <div className="text-5xl">🎉</div>
          <h2 className="font-bold text-xl text-gray-800">Credit Activated!</h2>
          <p className="text-sm text-gray-500">Your credit limit of <strong>₹5,00,000</strong> is ready to use at checkout.</p>
          <p className="text-xs text-gray-400">Payment reminders will be sent 7 and 1 day before due date via WhatsApp & SMS.</p>
          <a href="/dashboard" className="inline-block mt-2 bg-brand-500 text-white rounded-lg px-6 py-2 text-sm font-medium">Go to Dashboard</a>
        </div>
      )}
    </div>
  );
}
