import { OtpChannel, OtpDeliveryStatus, notifyLoginOtpWhatsApp } from "@matsrc/db";
import { sendOtpEmail } from "@/lib/contact-verification/email-sender";
import { prisma } from "@/lib/builder-db";
import { recordDeliveryAttempt } from "./challenge";

// Delivery orchestration for OTP challenges — owns provider selection but
// NEVER owns OTP generation/storage/verification (see ./challenge.ts), per
// the task spec's "the delivery provider must NOT own OTP verification"
// requirement.
//
// WhatsApp is now the PRIMARY login OTP delivery channel (see
// deliverOtpViaWhatsApp below) — the login UI calls it explicitly when the
// user presses "Send OTP on WhatsApp". It is a SEPARATE, explicit function
// from deliverOtp() (email) — WhatsApp failure NEVER automatically falls
// back to email; the UI must show the failure and let the user explicitly
// choose "Use email OTP instead", which calls deliverOtp() below.
//
// SMS delivery (MSG91) remains DISABLED for login OTP — email is now the
// explicit, user-selected FALLBACK (not an automatic one) rather than the
// default. MSG91 was already a permanently-stubbed, never-really-sends
// provider (see ./providers/msg91-sms.provider.ts) — this removes the dead
// attempt/fallback indirection rather than changing any real behavior: no
// OTP was ever actually delivered via SMS before this change either.
// Re-enabling SMS later only requires restoring the `target.phone` branch
// below (the Msg91SmsProvider class and SmsOtpProvider interface are left
// untouched for that purpose).
//
// Reuses the EXISTING, already-wired sendOtpEmail() (nodemailer over SES
// SMTP) from apps/web/lib/contact-verification/email-sender.ts as-is —
// this is the one genuinely working email delivery mechanism, so it is
// called directly rather than re-implemented.

export type DeliveryTarget = {
  // Kept for call-site compatibility (both C20 and C37 still pass a phone
  // when one is on file) but currently IGNORED — SMS delivery is disabled,
  // see the module comment above.
  phone?: string | null;
  // The email address OTPs are always delivered to.
  email?: string | null;
};

export type DeliveryOutcome =
  | { ok: true; channel: "EMAIL"; maskedTarget: string }
  | {
      ok: false;
      // No usable email on file, or the email send itself failed — an
      // honest, actionable failure (never a fake success).
      code: "NO_EMAIL_FALLBACK" | "EMAIL_SEND_FAILED";
      message: string;
    };

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 3))}@${domain}`;
}

/**
 * Delivers `otp` via email only — SMS (MSG91) is currently disabled (see
 * module comment above), so `target.phone` is ignored entirely and every
 * OTP is sent to `target.email`:
 *   1. If no email address is on file, return an honest failure — never a
 *      fabricated "sent" result.
 *   2. Otherwise send via SES/SMTP, recorded against `challengeId` via
 *      recordDeliveryAttempt() for observability — without ever persisting
 *      the plaintext OTP or any provider secret.
 */
export async function deliverOtp(
  challengeId: string,
  target: DeliveryTarget,
  otp: string
): Promise<DeliveryOutcome> {
  if (!target.email) {
    return {
      ok: false,
      code: "NO_EMAIL_FALLBACK",
      message: "No registered email address is available to send the OTP to.",
    };
  }

  // The shared sendOtpEmail() helper (apps/web/lib/contact-verification/email-sender.ts)
  // deliberately soft-succeeds when SMTP is unconfigured, to keep the
  // Profile "change email" flow testable without real credentials in
  // dev/CI. C20/C37 have a STRICTER requirement (task spec §12/§13):
  // "Do not report OTP sent successfully if Nodemailer/SES failed" /
  // "fails clearly if required production configuration is missing" — so
  // this explicit config check runs FIRST and fails honestly rather than
  // silently delegating to that soft-success behaviour.
  if (!isSesEmailConfigured()) {
    await recordDeliveryAttempt(challengeId, {
      channel: OtpChannel.EMAIL,
      provider: "ses-smtp",
      status: OtpDeliveryStatus.NOT_CONFIGURED,
      error: "SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD are not configured — SES email OTP delivery is unavailable.",
    });
    return {
      ok: false,
      code: "EMAIL_SEND_FAILED",
      message: "We could not send the OTP to your registered email. Please try again later.",
    };
  }

  const emailResult = await sendOtpEmail(target.email, otp);
  if (!emailResult.ok) {
    await recordDeliveryAttempt(challengeId, {
      channel: OtpChannel.EMAIL,
      provider: "ses-smtp",
      status: OtpDeliveryStatus.FAILED,
      error: emailResult.error,
    });
    return {
      ok: false,
      code: "EMAIL_SEND_FAILED",
      message: "We could not send the OTP to your registered email. Please try again later.",
    };
  }

  await recordDeliveryAttempt(challengeId, {
    channel: OtpChannel.EMAIL,
    provider: "ses-smtp",
    status: OtpDeliveryStatus.SENT,
  });

  return { ok: true, channel: "EMAIL", maskedTarget: maskEmail(target.email) };
}

/**
 * Explicit SES/SMTP configuration check (task spec §12/§13 — "fails clearly
 * if required production configuration is missing", "distinguish email
 * configuration missing from email provider unavailable"). Mirrors exactly
 * the env vars email-sender.ts's getTransporter() requires.
 */
function isSesEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USERNAME && process.env.SMTP_PASSWORD);
}

/**
 * Masks a phone number for safe display — shows the leading "+<country code>"
 * prefix and the last 4 digits, masks everything in between (e.g.
 * "+91 ******9167" per the required login UI copy). Never exposes the full
 * number unnecessarily.
 */
function maskPhone(phone: string): string {
  if (phone.length <= 6) return "***";
  const prefixLen = phone.startsWith("+") ? 3 : 2; // "+91" or similar
  const prefix = phone.slice(0, prefixLen);
  const last4 = phone.slice(-4);
  const maskedLen = Math.max(phone.length - prefixLen - 4, 4);
  return `${prefix} ${"*".repeat(maskedLen)}${last4}`;
}

export type WhatsAppDeliveryOutcome =
  | { ok: true; channel: "WHATSAPP"; maskedTarget: string }
  | {
      ok: false;
      // Honest, actionable failure codes — the caller must present
      // "Use email OTP instead" rather than silently retrying another
      // channel. Never a fabricated "sent" result.
      code: "NO_WHATSAPP_NUMBER" | "WHATSAPP_SEND_FAILED";
      message: string;
    };

/**
 * Delivers `otp` via WhatsApp (buildohub_login_otp AUTHENTICATION template),
 * the PRIMARY login OTP channel. Calls the shared, framework-agnostic
 * notifyLoginOtpWhatsApp() (packages/db/lib/login-otp-whatsapp-notification.ts)
 * — this function owns ONLY: resolving the target number, calling that
 * shared sender, and recording the outcome against the OtpChallenge via
 * recordDeliveryAttempt(). It NEVER falls back to email automatically — see
 * this file's top doc comment.
 */
export async function deliverOtpViaWhatsApp(
  challengeId: string,
  whatsappNumber: string,
  otp: string
): Promise<WhatsAppDeliveryOutcome> {
  if (!whatsappNumber) {
    return {
      ok: false,
      code: "NO_WHATSAPP_NUMBER",
      message: "No WhatsApp-enabled number is available to send the OTP to.",
    };
  }

  const result = await notifyLoginOtpWhatsApp(prisma as any, { challengeId, phone: whatsappNumber, otp });

  if (!result.success) {
    await recordDeliveryAttempt(challengeId, {
      channel: OtpChannel.WHATSAPP,
      provider: "meta-whatsapp-cloud-api",
      status: OtpDeliveryStatus.FAILED,
      error: result.reason,
    });
    return {
      ok: false,
      code: "WHATSAPP_SEND_FAILED",
      message: "We couldn't send the OTP to WhatsApp.",
    };
  }

  await recordDeliveryAttempt(challengeId, {
    channel: OtpChannel.WHATSAPP,
    provider: "meta-whatsapp-cloud-api",
    status: OtpDeliveryStatus.SENT,
    providerMessageId: result.externalId || null,
  });

  return { ok: true, channel: "WHATSAPP", maskedTarget: maskPhone(whatsappNumber) };
}
