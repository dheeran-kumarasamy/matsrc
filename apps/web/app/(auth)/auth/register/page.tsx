"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

// UF-01 Steps 1–5
export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<"channel" | "otp" | "role">("channel");
  const [channel, setChannel] = useState<"phone" | "email">("phone");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [role, setRole] = useState<"BUILDER" | "SUPPLIER" | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, identifier, name }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      setStep("otp");
    } catch (err: any) {
      setError(err.message ?? "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, identifier, otp }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      setStep("role");
    } catch (err: any) {
      setError(err.message ?? "Invalid OTP");
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleSelect(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/set-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      // Redirect to KYC upload step
      router.push("/auth/kyc");
    } catch (err: any) {
      setError(err.message ?? "Failed to set role");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2 className="text-xl font-semibold text-gray-800 mb-2">Create your account</h2>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {["Details", "Verify OTP", "Select Role"].map((label, i) => {
          const stepIndex = ["channel", "otp", "role"].indexOf(step);
          return (
            <div key={label} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i <= stepIndex ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-400"}`}>
                {i + 1}
              </div>
              <span className={`text-xs ${i <= stepIndex ? "text-brand-500 font-medium" : "text-gray-400"}`}>{label}</span>
              {i < 2 && <div className={`h-px w-4 ${i < stepIndex ? "bg-brand-500" : "bg-gray-200"}`} />}
            </div>
          );
        })}
      </div>

      {step === "channel" && (
        <form onSubmit={handleSendOtp} className="space-y-4">
          {/* Social login */}
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Continue with Google
          </button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
            <div className="relative flex justify-center text-xs text-gray-400 bg-white px-2">or</div>
          </div>

          <input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />

          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button type="button" onClick={() => setChannel("phone")} className={`flex-1 py-2 text-sm font-medium ${channel === "phone" ? "bg-brand-500 text-white" : "text-gray-500 hover:bg-gray-50"}`}>Phone</button>
            <button type="button" onClick={() => setChannel("email")} className={`flex-1 py-2 text-sm font-medium ${channel === "email" ? "bg-brand-500 text-white" : "text-gray-500 hover:bg-gray-50"}`}>Email</button>
          </div>

          <input
            type={channel === "phone" ? "tel" : "email"}
            placeholder={channel === "phone" ? "+91 98765 43210" : "you@example.com"}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button type="submit" disabled={loading} className="w-full bg-brand-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? "Sending..." : "Send OTP"}
          </button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <p className="text-sm text-gray-500">Enter the 6-digit OTP sent to <strong>{identifier}</strong></p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="• • • • • •"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            required
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button type="submit" disabled={loading || otp.length < 6} className="w-full bg-brand-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? "Verifying..." : "Verify OTP"}
          </button>
        </form>
      )}

      {step === "role" && (
        <form onSubmit={handleRoleSelect} className="space-y-4">
          <p className="text-sm text-gray-500 mb-4">How will you use BuildMart?</p>
          <div className="grid grid-cols-2 gap-3">
            {(["BUILDER", "SUPPLIER"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`border-2 rounded-xl p-4 text-left transition-all ${role === r ? "border-brand-500 bg-brand-50" : "border-gray-200 hover:border-gray-300"}`}
              >
                <div className="text-2xl mb-1">{r === "BUILDER" ? "🏗️" : "🏭"}</div>
                <div className="font-semibold text-sm text-gray-800">{r === "BUILDER" ? "Builder" : "Supplier"}</div>
                <div className="text-xs text-gray-500 mt-1">{r === "BUILDER" ? "Buy construction materials" : "Sell construction materials"}</div>
              </button>
            ))}
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button type="submit" disabled={loading || !role} className="w-full bg-brand-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? "Saving..." : "Continue to KYC →"}
          </button>
        </form>
      )}

      <p className="text-center text-xs text-gray-400 mt-6">
        Already have an account?{" "}
        <Link href="/auth/login" className="text-brand-500 font-medium hover:underline">Sign in</Link>
      </p>
    </>
  );
}
