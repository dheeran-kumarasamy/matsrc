"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

// Supplier portal's new WhatsApp-primary / email-fallback login OTP widget.
// Calls apps/supplier/app/api/auth/send-otp and /verify-otp (new routes),
// which in turn use the shared OtpChallenge lifecycle and shared WhatsApp
// sender from @matsrc/db — see apps/supplier/lib/otp-service.ts. On
// successful verification, signs in via the Credentials provider added to
// apps/supplier/auth.ts (Google's provider/callback are untouched).
export function SupplierOtpLogin() {
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"identifier" | "otp">("identifier");
  const [loading, setLoading] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [whatsappFailed, setWhatsappFailed] = useState(false);
  const [error, setError] = useState("");

  async function sendOtp(requestChannel: "whatsapp" | "email") {
    setError("");
    setDeliveryMessage("");
    setWhatsappFailed(false);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: requestChannel, identifier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (requestChannel === "whatsapp") {
          // Never silently fall back to email.
          setWhatsappFailed(true);
          setError(data.message || "We couldn't send the OTP to WhatsApp.");
          return;
        }
        throw new Error(data.message);
      }
      setDeliveryMessage(typeof data.message === "string" ? data.message : "");
      setStep("otp");
    } catch (err: any) {
      setError(err.message ?? "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    await sendOtp(channel);
  }

  function handleUseEmailFallback() {
    setChannel("email");
    setIdentifier("");
    setWhatsappFailed(false);
    setError("");
    setStep("identifier");
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message);

      const signInResult = await signIn("credentials", {
        email: data.email,
        name: data.name || "",
        redirect: false,
      });
      if (!signInResult || signInResult.error) {
        throw new Error("Signed in but could not start your session. Please try again.");
      }

      window.location.href = "/dashboard";
    } catch (err: any) {
      setError(err.message ?? "Invalid OTP");
    } finally {
      setLoading(false);
    }
  }

  if (step === "otp") {
    return (
      <form onSubmit={handleVerifyOtp} className="space-y-3">
        <p className="text-sm font-medium text-gray-800">
          {channel === "whatsapp" ? "OTP sent to WhatsApp" : "We've sent your OTP to your registered email address"}
        </p>
        <p className="text-xs text-gray-500">{deliveryMessage || `Enter the 6-digit OTP sent to ${identifier}`}</p>
        <p className="text-xs text-gray-500">Enter the 6-digit code.</p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="• • • • • •"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
          required
          className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-base text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <button
          type="submit"
          disabled={loading || otp.length < 6}
          className="w-full rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Verifying..." : "Verify"}
        </button>
        {channel === "whatsapp" && (
          <button type="button" onClick={handleUseEmailFallback} className="w-full text-xs text-gray-500 hover:opacity-70">
            Didn&apos;t receive it? Use email OTP instead
          </button>
        )}
        <button type="button" onClick={() => setStep("identifier")} className="w-full text-xs text-gray-500 hover:opacity-70">
          Change {channel === "whatsapp" ? "number" : "email"}
        </button>
      </form>
    );
  }

  if (channel === "email") {
    return (
      <form onSubmit={handleSendOtp} className="space-y-2">
        <label className="block text-sm font-medium text-gray-800 mb-1">Email address</label>
        <input
          type="email"
          placeholder="you@example.com"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
          className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <button type="submit" disabled={loading} className="w-full rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-medium disabled:opacity-50 mt-2">
          {loading ? "Sending..." : "Send OTP via email"}
        </button>
        <button
          type="button"
          onClick={() => {
            setChannel("whatsapp");
            setIdentifier("");
            setError("");
          }}
          className="w-full text-xs text-gray-500 hover:opacity-70 mt-1"
        >
          Use WhatsApp instead
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSendOtp} className="space-y-2">
      <label className="block text-sm font-medium text-gray-800 mb-1">WhatsApp mobile number</label>
      <input
        type="tel"
        placeholder="+91 98765 43210"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        required
        className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
      {/* Mandatory UX requirement — same wording as the Buyer portal. */}
      <p className="text-xs text-gray-500 mb-2">
        Enter the WhatsApp-enabled mobile number linked to your Buildohub account. We&apos;ll send your OTP to this number on WhatsApp.
      </p>
      {error && <p className="text-red-500 text-xs">{error}</p>}
      <button type="submit" disabled={loading} className="w-full rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-medium disabled:opacity-50 mt-2">
        {loading ? "Sending..." : "Send OTP on WhatsApp"}
      </button>
      <button type="button" onClick={handleUseEmailFallback} className="w-full text-xs text-gray-500 hover:opacity-70 mt-1">
        {whatsappFailed ? "Use email OTP instead" : "Don't have WhatsApp? Use email OTP instead"}
      </button>
    </form>
  );
}
