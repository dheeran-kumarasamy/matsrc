"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// UF-01 Steps 1–5
export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<"channel" | "otp" | "role" | "contact">("channel");
  const [channel, setChannel] = useState<"phone" | "email">("phone");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [role, setRole] = useState<"BUILDER" | "SUPPLIER" | "">("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [whatsappConsent, setWhatsappConsent] = useState(true);
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
    setStep("contact");
  }

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/set-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          role,
          whatsappNumber: whatsappNumber.trim() || null,
          whatsappConsent,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      // Redirect to KYC upload step
      router.push("/auth/kyc");
    } catch (err: any) {
      setError(err.message ?? "Failed to save contact info");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2 className="posh-heading text-2xl mb-2" style={{ color: "var(--posh-fg)" }}>Create your account</h2>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto">
        {["Details", "Verify OTP", "Select Role", "Contact"].map((label, i) => {
          const stepIndex = ["channel", "otp", "role", "contact"].indexOf(step);
          const done = i <= stepIndex;
          return (
            <div key={label} className="flex items-center gap-2 flex-shrink-0">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                style={done ? { background: "var(--posh-primary)", color: "var(--posh-primary-fg)" } : { background: "var(--posh-border)", color: "var(--posh-fg-muted)" }}
              >
                {i + 1}
              </div>
              <span className="text-xs whitespace-nowrap font-medium" style={{ color: done ? "var(--posh-primary)" : "var(--posh-fg-muted)" }}>{label}</span>
              {i < 3 && <div className="h-px w-4 flex-shrink-0" style={{ background: i < stepIndex ? "var(--posh-primary)" : "var(--posh-border)" }} />}
            </div>
          );
        })}
      </div>

      {step === "channel" && (
        <form onSubmit={handleSendOtp} className="space-y-4">
          {/* Social login */}
          <a
            href="/api/auth/signin/google?callbackUrl=%2Fdashboard"
            className="w-full flex items-center justify-center gap-3 rounded-lg border py-2.5 text-sm font-medium transition-colors hover:opacity-80"
            style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg)" }}
          >
            Continue with Google
          </a>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t" style={{ borderColor: "var(--posh-border)" }} /></div>
            <div className="relative flex justify-center text-xs px-2" style={{ color: "var(--posh-fg-muted)", background: "var(--posh-bg-card)" }}>or</div>
          </div>

          <input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-lg border px-4 py-2.5 text-base focus:outline-none focus:ring-2"
            style={{ borderColor: "var(--posh-border)", background: "transparent", color: "var(--posh-fg)" }}
          />

          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--posh-border)" }}>
            <button type="button" onClick={() => setChannel("phone")} className="flex-1 py-2 text-sm font-medium transition-colors"
              style={channel === "phone" ? { background: "var(--posh-primary)", color: "var(--posh-primary-fg)" } : { color: "var(--posh-fg-muted)" }}>Phone</button>
            <button type="button" onClick={() => setChannel("email")} className="flex-1 py-2 text-sm font-medium transition-colors"
              style={channel === "email" ? { background: "var(--posh-primary)", color: "var(--posh-primary-fg)" } : { color: "var(--posh-fg-muted)" }}>Email</button>
          </div>

          <input
            type={channel === "phone" ? "tel" : "email"}
            placeholder={channel === "phone" ? "+91 98765 43210" : "you@example.com"}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            className="w-full rounded-lg border px-4 py-2.5 text-base focus:outline-none focus:ring-2"
            style={{ borderColor: "var(--posh-border)", background: "transparent", color: "var(--posh-fg)" }}
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={loading} className="posh-btn-solid w-full min-h-[44px] rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? "Sending..." : "Send OTP"}
          </button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <p className="text-sm" style={{ color: "var(--posh-fg-muted)" }}>Enter the 6-digit OTP sent to <strong style={{ color: "var(--posh-fg)" }}>{identifier}</strong></p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="• • • • • •"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            required
            className="w-full rounded-lg border px-4 py-2.5 text-base text-center tracking-widest focus:outline-none focus:ring-2"
            style={{ borderColor: "var(--posh-border)", background: "transparent", color: "var(--posh-fg)" }}
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={loading || otp.length < 6} className="posh-btn-solid w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? "Verifying..." : "Verify OTP"}
          </button>
        </form>
      )}

      {step === "role" && (
        <form onSubmit={handleRoleSelect} className="space-y-4">
          <p className="text-sm mb-4" style={{ color: "var(--posh-fg-muted)" }}>How will you use Buildohub.in?</p>
          <div className="grid grid-cols-2 gap-3">
            {(["BUILDER", "SUPPLIER"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className="rounded-xl border-2 p-4 text-left transition-all"
                style={role === r
                  ? { borderColor: "var(--posh-primary)", background: "rgba(196,145,90,0.10)" }
                  : { borderColor: "var(--posh-border)" }}
              >
                <div className="text-2xl mb-1">{r === "BUILDER" ? "🏗️" : "🏭"}</div>
                <div className="font-semibold text-sm" style={{ color: "var(--posh-fg)" }}>{r === "BUILDER" ? "Builder" : "Supplier"}</div>
                <div className="text-xs mt-1" style={{ color: "var(--posh-fg-muted)" }}>{r === "BUILDER" ? "Buy construction materials" : "Sell construction materials"}</div>
              </button>
            ))}
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={loading || !role} className="posh-btn-solid w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? "Saving..." : "Continue →"}
          </button>
        </form>
      )}

      {step === "contact" && (
        <form onSubmit={handleContactSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--posh-fg-muted)" }}>WhatsApp Number (Optional)</label>
            <p className="text-xs mb-2" style={{ color: "var(--posh-fg-muted)" }}>For order updates & support. We'll use your phone number if you skip this.</p>
            <input
              type="tel"
              placeholder="+91 98765 43210"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              className="w-full rounded-lg border px-4 py-2.5 text-base focus:outline-none focus:ring-2"
              style={{ borderColor: "var(--posh-border)", background: "transparent", color: "var(--posh-fg)" }}
            />
          </div>

          <div className="rounded-lg border p-3 space-y-2" style={{ background: "rgba(var(--posh-wash-rgb),0.04)", borderColor: "var(--posh-border)" }}>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={whatsappConsent}
                onChange={(e) => setWhatsappConsent(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded accent-[color:var(--posh-primary)]"
              />
              <span className="text-xs" style={{ color: "var(--posh-fg-muted)" }}>
                <strong style={{ color: "var(--posh-fg)" }}>Enable WhatsApp Notifications</strong><br/>
                Get real-time order updates, price alerts, and support messages on WhatsApp
              </span>
            </label>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={loading} className="posh-btn-solid w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? "Saving..." : "Continue to KYC →"}
          </button>
        </form>
      )}

      <p className="text-center text-xs mt-6" style={{ color: "var(--posh-fg-muted)" }}>
        Already have an account?{" "}
        <Link href="/auth/login" className="font-medium hover:underline" style={{ color: "var(--posh-primary)" }}>Sign in</Link>
      </p>
    </>
  );
}
