"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { authErrorMessage } from "@/lib/auth-error-message";
import GoogleIcon from "@/components/shared/GoogleIcon";

// UF-01 Step 2–4: Choose channel, enter credentials, verify OTP
//
// Wrapped in Suspense because useSearchParams() (needed to read Auth.js's
// `?error=...` redirect, see P0 fix below) requires it in the App Router —
// without this, `next build` fails/deopts the whole route to client-only
// rendering.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // WhatsApp is the PRIMARY login OTP channel — defaults here, per the
  // required login hierarchy (WhatsApp primary / Email explicit fallback /
  // Google separate). "whatsapp" and legacy "phone" are the same identifier
  // kind (a phone number) server-side — see /api/auth/send-otp's alias.
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"identifier" | "otp">("identifier");
  const [loading, setLoading] = useState(false);
  // Honest delivery status from /api/auth/send-otp (e.g. "We've sent your
  // OTP to WhatsApp." or the email-fallback confirmation) — never claims a
  // channel delivered the OTP when it didn't.
  const [deliveryMessage, setDeliveryMessage] = useState("");
  // Set ONLY when the explicitly-requested WhatsApp send failed — surfaces
  // the required "Use email OTP instead" affordance WITHOUT automatically
  // sending an email OTP on the user's behalf (never an automatic fallback).
  const [whatsappFailed, setWhatsappFailed] = useState(false);
  // P0 fix: surface Auth.js's `?error=...` redirect (e.g. after a failed
  // Google sign-in) as a real message instead of silently dropping it —
  // previously the page never read this param at all, so a failed Google
  // login looked identical to the page just doing nothing.
  const [error, setError] = useState(() => authErrorMessage(searchParams.get("error")) || "");

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
          // Never silently fall back to email — record the failure and let
          // the user explicitly choose "Use email OTP instead".
          setWhatsappFailed(true);
          setError(data.message || "We couldn't send the OTP to WhatsApp.");
          return;
        }
        throw new Error(data.message);
      }
      // Surface the ACTUAL delivery channel/target — never a generic "OTP sent".
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
    // Explicit, user-initiated switch — never automatic. Re-issuing on the
    // email channel invalidates the previously-issued WhatsApp OtpChallenge
    // per the existing issueOtpChallenge() scope-invalidation lifecycle
    // (same (purpose, identifier) scope, new channel), so only ONE OTP is
    // ever valid for this login attempt at a time.
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

      // /api/auth/verify-otp only upserts the User row — it doesn't create a
      // session by itself. Complete the actual sign-in via the existing
      // Credentials provider (apps/web/auth.ts) using the email it resolved
      // (phone identifiers are mapped to a stable placeholder email there),
      // so subsequent authenticated requests carry a real session cookie.
      const signInResult = await signIn("credentials", {
        email: data.email,
        name: data.name || "",
        redirect: false,
      });
      if (!signInResult || signInResult.error) {
        throw new Error("Signed in but could not start your session. Please try again.");
      }

      router.push("/newdashboard");
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? "Invalid OTP");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2
        className="posh-heading text-2xl mb-6"
        style={{ color: "var(--posh-fg)" }}
      >
        Welcome back
      </h2>

      {step === "identifier" && channel === "whatsapp" ? (
        <form onSubmit={handleSendOtp} className="space-y-2">
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--posh-fg)" }}>
            WhatsApp mobile number
          </label>
          <input
            type="tel"
            placeholder="+91 98765 43210"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            className="w-full rounded-xl border px-4 py-3 text-base focus:outline-none focus:ring-2"
            style={{
              borderColor: "var(--posh-border)",
              background: "transparent",
              color: "var(--posh-fg)",
              focusRingColor: "var(--posh-primary)",
            } as React.CSSProperties}
          />
          {/* Mandatory UX requirement: the user must understand the number
              entered here must be WhatsApp-enabled and accessible to them —
              never implied that any mobile number is sufficient. */}
          <p className="text-xs mb-2" style={{ color: "var(--posh-fg-muted)" }}>
            Enter the WhatsApp-enabled mobile number linked to your Buildohub account. We&apos;ll send your OTP to this number on WhatsApp.
          </p>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="posh-btn-solid w-full min-h-[44px] rounded-xl py-2.5 text-sm font-medium disabled:opacity-50 mt-2"
          >
            {loading ? "Sending..." : "Send OTP on WhatsApp"}
          </button>
          {/* Always-visible, easy-to-access fallback — required whether or
              not a WhatsApp send has been attempted yet, so a user who
              already knows they lack WhatsApp access never has to fail
              first. */}
          <button
            type="button"
            onClick={handleUseEmailFallback}
            className="w-full text-xs text-center mt-1 transition-opacity hover:opacity-70"
            style={{ color: "var(--posh-fg-muted)" }}
          >
            {whatsappFailed ? "Use email OTP instead" : "Don't have access to WhatsApp? Use email OTP instead"}
          </button>
        </form>
      ) : step === "identifier" && channel === "email" ? (
        <form onSubmit={handleSendOtp} className="space-y-2">
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--posh-fg)" }}>
            Email address
          </label>
          <input
            type="email"
            placeholder="you@example.com"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            className="w-full rounded-xl border px-4 py-3 text-base focus:outline-none focus:ring-2"
            style={{
              borderColor: "var(--posh-border)",
              background: "transparent",
              color: "var(--posh-fg)",
              focusRingColor: "var(--posh-primary)",
            } as React.CSSProperties}
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="posh-btn-solid w-full min-h-[44px] rounded-xl py-2.5 text-sm font-medium disabled:opacity-50 mt-2"
          >
            {loading ? "Sending..." : "Send OTP via email"}
          </button>
          <button
            type="button"
            onClick={() => {
              setChannel("whatsapp");
              setIdentifier("");
              setError("");
            }}
            className="w-full text-xs text-center mt-1 transition-opacity hover:opacity-70"
            style={{ color: "var(--posh-fg-muted)" }}
          >
            Use WhatsApp instead
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <p className="text-sm font-medium" style={{ color: "var(--posh-fg)" }}>
            {channel === "whatsapp" ? "OTP sent to WhatsApp" : "We've sent your OTP to your registered email address"}
          </p>
          <p className="text-sm" style={{ color: "var(--posh-fg-muted)" }}>
            {deliveryMessage || (
              <>
                Enter the 6-digit OTP sent to{" "}
                <strong style={{ color: "var(--posh-fg)" }}>{identifier}</strong>
              </>
            )}
          </p>
          <p className="text-xs" style={{ color: "var(--posh-fg-muted)" }}>
            Enter the 6-digit code.
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="• • • • • •"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            required
            className="w-full rounded-xl border px-4 py-3 text-base text-center tracking-widest focus:outline-none focus:ring-2"
            style={{ borderColor: "var(--posh-border)", background: "transparent", color: "var(--posh-fg)" }}
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading || otp.length < 6}
            className="posh-btn-solid w-full rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Verify"}
          </button>
          {channel === "whatsapp" && (
            <button
              type="button"
              onClick={handleUseEmailFallback}
              className="w-full text-xs text-center transition-opacity hover:opacity-70"
              style={{ color: "var(--posh-fg-muted)" }}
            >
              Didn&apos;t receive it? Use email OTP instead
            </button>
          )}
          <button
            type="button"
            onClick={() => setStep("identifier")}
            className="w-full text-xs transition-opacity hover:opacity-70"
            style={{ color: "var(--posh-fg-muted)" }}
          >
            Change {channel === "whatsapp" ? "number" : "email"}
          </button>
        </form>
      )}

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t" style={{ borderColor: "var(--posh-border)" }} />
        </div>
        <div
          className="relative flex justify-center text-xs px-2"
          style={{ color: "var(--posh-fg-muted)", background: "var(--posh-bg-card)" }}
        >
          OR
        </div>
      </div>

      {/* Social login — FR-01. UNCHANGED: same signIn("google", ...) call,
          same callbackUrl, same GoogleIcon component as before this
          implementation — only its position on the page moved (now below
          the WhatsApp/email OTP form instead of above it), per the required
          WhatsApp-primary login hierarchy. Google remains a separate,
          untouched authentication path. */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/newdashboard" })}
          className="flex items-center justify-center gap-3 rounded-xl border py-2.5 text-sm font-medium transition-colors hover:opacity-80"
          style={{ borderColor: "var(--posh-border)", color: "var(--posh-fg)", background: "transparent" }}
        >
          <GoogleIcon />
          <span>Continue with Google</span>
        </button>
      </div>

      <p className="text-center text-xs mt-6" style={{ color: "var(--posh-fg-muted)" }}>
        New to Buildohub.in?{" "}
        <Link
          href="/auth/register"
          className="font-medium hover:underline"
          style={{ color: "var(--posh-primary)" }}
        >
          Create account
        </Link>
      </p>
    </>
  );
}
