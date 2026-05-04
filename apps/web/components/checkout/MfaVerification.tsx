"use client";

import { useState } from "react";

// FR-03: MFA verification before payment
export default function MfaVerification({ onVerified }: { onVerified: () => void }) {
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      onVerified();
    } catch (err: any) {
      setError(err.message ?? "Invalid code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto">
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center space-y-5">
        <div className="text-3xl">🔐</div>
        <div>
          <h2 className="font-bold text-gray-800">Verify Your Identity</h2>
          <p className="text-sm text-gray-400 mt-1">Enter the OTP sent to your registered phone to authorise this payment.</p>
        </div>
        <form onSubmit={handleVerify} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="• • • • • •"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            required
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button type="submit" disabled={loading || otp.length < 6} className="w-full bg-brand-500 text-white rounded-lg py-3 text-sm font-medium disabled:opacity-50">
            {loading ? "Verifying..." : "Confirm & Place Order"}
          </button>
        </form>
      </div>
    </div>
  );
}
