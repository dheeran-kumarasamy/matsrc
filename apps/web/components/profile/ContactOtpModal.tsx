"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// OTP verification modal for the /profile "change email"/"change phone"
// flow (task spec §2.5 / §3.5). Deliberately generic over `channel` so both
// flows share one implementation — the only differences are copy and which
// API values are passed in by the caller.

export type ContactOtpChannel = "EMAIL" | "PHONE";

type Props = {
  open: boolean;
  channel: ContactOtpChannel;
  maskedTarget: string;
  expiresAt: string; // ISO timestamp
  resendAvailableAt: string; // ISO timestamp
  onVerify: (otp: string) => Promise<{ ok: boolean; message?: string }>;
  onResend: () => Promise<{ ok: boolean; maskedTarget?: string; expiresAt?: string; resendAvailableAt?: string; message?: string }>;
  onCancel: () => void;
  onVerified: () => void;
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function ContactOtpModal({
  open,
  channel,
  maskedTarget,
  expiresAt,
  resendAvailableAt,
  onVerify,
  onResend,
  onCancel,
  onVerified,
}: Props) {
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [expiresAtState, setExpiresAtState] = useState(expiresAt);
  const [resendAvailableAtState, setResendAvailableAtState] = useState(resendAvailableAt);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setOtp("");
    setError("");
    setInfo("");
    setExpiresAtState(expiresAt);
    setResendAvailableAtState(resendAvailableAt);
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [open]);

  const expiresInMs = new Date(expiresAtState).getTime() - now;
  const isExpired = expiresInMs <= 0;
  const resendInMs = new Date(resendAvailableAtState).getTime() - now;
  const canResend = resendInMs <= 0;

  const label = channel === "EMAIL" ? "email address" : "phone number";

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (verifying || otp.length !== 6 || isExpired) return;
    setError("");
    setInfo("");
    setVerifying(true);
    try {
      const result = await onVerify(otp);
      if (result.ok) {
        onVerified();
      } else {
        setError(result.message || "Incorrect code. Please try again.");
        setOtp("");
        inputRef.current?.focus();
      }
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (resending || !canResend) return;
    setError("");
    setInfo("");
    setResending(true);
    try {
      const result = await onResend();
      if (result.ok) {
        setOtp("");
        setInfo(`A new code was sent to ${result.maskedTarget || maskedTarget}.`);
        if (result.expiresAt) setExpiresAtState(result.expiresAt);
        if (result.resendAvailableAt) setResendAvailableAtState(result.resendAvailableAt);
      } else {
        setError(result.message || "Couldn't resend the code. Please try again shortly.");
      }
    } finally {
      setResending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verify your new {label}</DialogTitle>
          <DialogDescription>
            We sent a verification code to your new {label}:{" "}
            <span className="font-medium text-slate-700">{maskedTarget}</span>. Your current {label} stays active
            until this is verified.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleVerify} className="space-y-4 p-5">
          <div>
            <label htmlFor="contact-otp-input" className="block text-xs font-medium text-gray-700 mb-1">
              6-digit verification code
            </label>
            <input
              id="contact-otp-input"
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={verifying || isExpired}
              aria-describedby="contact-otp-status"
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-center text-xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
            />
          </div>

          <p id="contact-otp-status" className="text-xs text-gray-500" role="status" aria-live="polite">
            {isExpired
              ? "This code has expired. Request a new one below."
              : `Code expires in ${formatCountdown(expiresInMs)}.`}
          </p>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-lg p-3" role="alert">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          {info && !error && (
            <div className="bg-green-50 border border-green-100 rounded-lg p-3" role="status">
              <p className="text-sm text-green-700">{info}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={verifying || otp.length !== 6 || isExpired}
            className="posh-btn-solid w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {verifying ? "Verifying..." : "Verify"}
          </button>

          <div className="flex items-center justify-between text-xs">
            <button type="button" onClick={onCancel} className="text-gray-500 hover:text-gray-700 underline">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={resending || !canResend}
              className="text-[color:var(--posh-primary)] hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {resending ? "Sending..." : canResend ? "Resend code" : `Resend in ${formatCountdown(resendInMs)}`}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
