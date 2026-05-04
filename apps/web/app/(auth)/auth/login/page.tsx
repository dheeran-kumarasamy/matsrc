"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// UF-01 Step 2–4: Choose channel, enter credentials, verify OTP
export default function LoginPage() {
  const router = useRouter();
  const [channel, setChannel] = useState<"phone" | "email">("phone");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"identifier" | "otp">("identifier");
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
        body: JSON.stringify({ channel, identifier }),
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
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message ?? "Invalid OTP");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2 className="text-xl font-semibold text-gray-800 mb-6">Welcome back</h2>

      {/* Social login — FR-01 */}
      <div className="flex flex-col gap-3 mb-6">
        <button className="flex items-center justify-center gap-3 border border-gray-200 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors">
          <span>Continue with Google</span>
        </button>
        <button className="flex items-center justify-center gap-3 border border-gray-200 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors">
          <span>Continue with Facebook</span>
        </button>
      </div>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs text-gray-400 bg-white px-2">or</div>
      </div>

      {/* Channel toggle */}
      <div className="flex rounded-lg border border-gray-200 mb-4 overflow-hidden">
        <button
          type="button"
          onClick={() => setChannel("phone")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${channel === "phone" ? "bg-brand-500 text-white" : "text-gray-500 hover:bg-gray-50"}`}
        >
          Phone
        </button>
        <button
          type="button"
          onClick={() => setChannel("email")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${channel === "email" ? "bg-brand-500 text-white" : "text-gray-500 hover:bg-gray-50"}`}
        >
          Email
        </button>
      </div>

      {step === "identifier" ? (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <input
            type={channel === "phone" ? "tel" : "email"}
            placeholder={channel === "phone" ? "+91 98765 43210" : "you@example.com"}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-500 hover:bg-brand-600 text-white rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send OTP"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <p className="text-sm text-gray-500">
            Enter the 6-digit OTP sent to <strong>{identifier}</strong>
          </p>
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
          <button
            type="submit"
            disabled={loading || otp.length < 6}
            className="w-full bg-brand-500 hover:bg-brand-600 text-white rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Verify OTP"}
          </button>
          <button type="button" onClick={() => setStep("identifier")} className="w-full text-xs text-gray-400 hover:text-gray-600">
            Change {channel}
          </button>
        </form>
      )}

      <p className="text-center text-xs text-gray-400 mt-6">
        New to BuildMart?{" "}
        <Link href="/auth/register" className="text-brand-500 font-medium hover:underline">
          Create account
        </Link>
      </p>
    </>
  );
}
