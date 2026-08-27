"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { builderApiGet, builderApiPost, builderApiDelete } from "@/lib/api";
import ContactOtpModal, { type ContactOtpChannel } from "@/components/profile/ContactOtpModal";

type ContactInfo = {
  name: string | null;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  whatsappNumber: string | null;
  whatsappEnabled: boolean;
};

type PendingVerification = {
  channel: ContactOtpChannel;
  maskedTarget: string;
  expiresAt: string;
  resendAvailableAt: string;
};

function VerifiedBadge({ verified }: { verified: boolean }) {
  return (
    <span
      className={
        "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
        (verified
          ? "bg-green-50 text-green-700 border border-green-100"
          : "bg-amber-50 text-amber-700 border border-amber-100")
      }
    >
      {verified ? "Verified" : "Unverified"}
    </span>
  );
}

export default function BuilderProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [contact, setContact] = useState<ContactInfo | null>(null);

  const [emailInput, setEmailInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [emailError, setEmailError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);

  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [whatsappError, setWhatsappError] = useState("");
  const [whatsappSuccess, setWhatsappSuccess] = useState("");

  const [pending, setPending] = useState<PendingVerification | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/login");
    }
  }, [status, router]);

  const loadContact = useCallback(async () => {
    try {
      const data = await builderApiGet<ContactInfo>("/update-contact");
      setContact(data);
      setEmailInput(data.email || "");
      setPhoneInput(data.phone || "");
      setWhatsappNumber(data.whatsappNumber || "");
      setWhatsappEnabled(data.whatsappEnabled);
    } catch {
      // Non-fatal — the page still renders with session-derived fallbacks below.
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      loadContact();
    }
  }, [status, loadContact]);

  // §8: changing only email/only phone verifies only that channel — each
  // form below POSTs independently to /profile/contact-verification, so a
  // pending email change and a pending phone change never interfere with
  // each other (each is its own PendingContactVerification row, keyed by
  // channel).
  async function handleChangeEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError("");
    const trimmed = emailInput.trim();
    if (!trimmed) {
      setEmailError("Email address is required");
      return;
    }
    if (emailSubmitting) return;
    setEmailSubmitting(true);
    try {
      const result = await builderApiPost<{ maskedTarget: string; expiresAt: string; resendAvailableAt: string }>(
        "/profile/contact-verification",
        { channel: "EMAIL", value: trimmed }
      );
      setPending({ channel: "EMAIL", ...result });
    } catch (err: any) {
      setEmailError(err.message || "Failed to send verification code");
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function handleChangePhone(e: React.FormEvent) {
    e.preventDefault();
    setPhoneError("");
    const trimmed = phoneInput.trim();
    if (!trimmed) {
      setPhoneError("Phone number is required");
      return;
    }
    if (phoneSubmitting) return;
    setPhoneSubmitting(true);
    try {
      const result = await builderApiPost<{ maskedTarget: string; expiresAt: string; resendAvailableAt: string }>(
        "/profile/contact-verification",
        { channel: "PHONE", value: trimmed }
      );
      setPending({ channel: "PHONE", ...result });
    } catch (err: any) {
      setPhoneError(err.message || "Failed to send verification code");
    } finally {
      setPhoneSubmitting(false);
    }
  }

  // Unrelated fields (WhatsApp number/opt-in) go through the pre-existing
  // /update-contact route, which never touches email/phone or their
  // verification state (§8: unrelated field updates must not trigger OTP).
  async function handleUpdateWhatsapp(e: React.FormEvent) {
    e.preventDefault();
    setWhatsappError("");
    setWhatsappSuccess("");
    if (whatsappLoading) return;
    setWhatsappLoading(true);
    try {
      await builderApiPost("/update-contact", {
        whatsappNumber: whatsappNumber.trim() || null,
        whatsappEnabled,
      });
      setWhatsappSuccess("WhatsApp preferences updated successfully!");
      setTimeout(() => setWhatsappSuccess(""), 3000);
    } catch (err: any) {
      setWhatsappError(err.message || "Failed to update WhatsApp preferences");
    } finally {
      setWhatsappLoading(false);
    }
  }

  async function handleModalVerify(otp: string): Promise<{ ok: boolean; message?: string }> {
    if (!pending) return { ok: false, message: "No pending verification." };
    try {
      await builderApiPost("/profile/contact-verification/verify", { channel: pending.channel, otp });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, message: err.message || "Incorrect code. Please try again." };
    }
  }

  async function handleModalResend() {
    if (!pending) return { ok: false, message: "No pending verification." };
    const value = pending.channel === "EMAIL" ? emailInput.trim() : phoneInput.trim();
    try {
      const result = await builderApiPost<{ maskedTarget: string; expiresAt: string; resendAvailableAt: string }>(
        "/profile/contact-verification",
        { channel: pending.channel, value }
      );
      setPending({ channel: pending.channel, ...result });
      return { ok: true, ...result };
    } catch (err: any) {
      return { ok: false, message: err.message || "Couldn't resend the code." };
    }
  }

  async function handleModalCancel() {
    if (pending) {
      // Best-effort cleanup — the row also naturally expires after 10
      // minutes if this call fails, so a failure here is non-fatal.
      builderApiDelete(`/profile/contact-verification?channel=${pending.channel}`).catch(() => {});
    }
    setPending(null);
    // Restore the input to the last known-verified value (spec §2.7/§3.7).
    if (contact) {
      setEmailInput(contact.email || "");
      setPhoneInput(contact.phone || "");
    }
  }

  function handleModalVerified() {
    setPending(null);
    setEmailError("");
    setPhoneError("");
    loadContact();
  }

  if (status === "loading") {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  if (!session?.user) {
    return null;
  }

  const displayEmail = contact?.email ?? session.user.email ?? "";
  const displayPhone = contact?.phone ?? "";
  const emailVerified = contact?.emailVerified ?? false;
  const phoneVerified = contact?.phoneVerified ?? false;

  return (
    <div className="max-w-md mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 mb-1">Your Profile</h1>
        <p className="text-sm text-gray-500">Manage your contact information and notification preferences</p>
      </div>

      {/* Name - Read-only */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Full Name</label>
        <input
          type="text"
          value={session.user.name || ""}
          disabled
          className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm bg-gray-50 text-gray-500"
        />
      </div>

      {/* Email change form — requires OTP verification before it takes effect */}
      <form onSubmit={handleChangeEmail} className="space-y-2 border-t border-gray-100 pt-6">
        <label htmlFor="profile-email" className="flex items-center text-xs font-medium text-gray-700">
          Email Address
          <VerifiedBadge verified={emailVerified} />
        </label>
        <p className="text-xs text-gray-500">Changing this requires verifying the new address with a one-time code.</p>
        <div className="flex gap-2">
          <input
            id="profile-email"
            type="email"
            placeholder="you@example.com"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="submit"
            disabled={emailSubmitting || emailInput.trim() === displayEmail}
            className="posh-btn-solid rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
          >
            {emailSubmitting ? "Sending..." : "Save"}
          </button>
        </div>
        {emailError && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-3" role="alert">
            <p className="text-sm text-red-700">{emailError}</p>
          </div>
        )}
      </form>

      {/* Phone change form — requires OTP verification before it takes effect */}
      <form onSubmit={handleChangePhone} className="space-y-2 border-t border-gray-100 pt-6">
        <label htmlFor="profile-phone" className="flex items-center text-xs font-medium text-gray-700">
          Phone Number
          <VerifiedBadge verified={phoneVerified} />
        </label>
        <p className="text-xs text-gray-500">
          Your primary contact number for order updates. Changing it requires OTP verification.
        </p>
        <div className="flex gap-2">
          <input
            id="profile-phone"
            type="tel"
            placeholder="+91 98765 43210"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="submit"
            disabled={phoneSubmitting || phoneInput.trim() === displayPhone}
            className="posh-btn-solid rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
          >
            {phoneSubmitting ? "Sending..." : "Save"}
          </button>
        </div>
        {phoneError && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-3" role="alert">
            <p className="text-sm text-red-700">{phoneError}</p>
          </div>
        )}
      </form>

      {/* WhatsApp preferences — unrelated field, saves immediately, never triggers OTP */}
      <form onSubmit={handleUpdateWhatsapp} className="space-y-4 border-t border-gray-100 pt-6">
        <div>
          <label htmlFor="profile-whatsapp" className="block text-xs font-medium text-gray-700 mb-1">
            WhatsApp Number (Optional)
          </label>
          <p className="text-xs text-gray-500 mb-2">For WhatsApp notifications. Leave blank to use your phone number.</p>
          <input
            id="profile-whatsapp"
            type="tel"
            placeholder="+91 98765 43210"
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="bg-[rgba(var(--posh-wash-rgb),0.04)] border border-[color:var(--posh-border)] rounded-lg p-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={whatsappEnabled}
              onChange={(e) => setWhatsappEnabled(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            />
            <span className="text-xs text-gray-700">
              <strong>Enable WhatsApp Notifications</strong>
              <br />
              Receive order updates, price alerts, and support messages on WhatsApp
            </span>
          </label>
        </div>

        {whatsappError && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-3">
            <p className="text-sm text-red-700">{whatsappError}</p>
          </div>
        )}
        {whatsappSuccess && (
          <div className="bg-green-50 border border-green-100 rounded-lg p-3">
            <p className="text-sm text-green-700">{whatsappSuccess}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={whatsappLoading}
          className="posh-btn-solid w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {whatsappLoading ? "Updating..." : "Update WhatsApp Preferences"}
        </button>
      </form>

      {pending && (
        <ContactOtpModal
          open
          channel={pending.channel}
          maskedTarget={pending.maskedTarget}
          expiresAt={pending.expiresAt}
          resendAvailableAt={pending.resendAvailableAt}
          onVerify={handleModalVerify}
          onResend={handleModalResend}
          onCancel={handleModalCancel}
          onVerified={handleModalVerified}
        />
      )}
    </div>
  );
}
