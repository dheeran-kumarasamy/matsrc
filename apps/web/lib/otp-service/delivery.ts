import { OtpChannel, OtpDeliveryStatus } from "@matsrc/db";
import { sendOtpEmail } from "@/lib/contact-verification/email-sender";
import { recordDeliveryAttempt } from "./challenge";

// Delivery orchestration for OTP challenges — owns provider selection but
// NEVER owns OTP generation/storage/verification (see ./challenge.ts), per
// the task spec's "the delivery provider must NOT own OTP verification"
// requirement.
//
// SMS delivery (MSG91) is TEMPORARILY DISABLED — every OTP is now sent via
// email only, regardless of whether a phone number is on file. MSG91 was
// already a permanently-stubbed, never-really-sends provider (see
// ./providers/msg91-sms.provider.ts), so this removes the dead
// attempt/fallback indirection rather than changing any real behavior: no
// OTP was ever actually delivered via SMS before this change either.
// Re-enabling SMS later only requires restoring the `target.phone` branch
// below (the Msg91SmsProvider class and SmsOtpProvider interface are left
// untouched for that purpose).
//
// Reuses the EXISTING, already-wired sendOtpEmail() (nodemailer over SES
// SMTP) from apps/web/lib/contact-verification/email-sender.ts as-is —
// this is the one genuinely working delivery mechanism per the task spec,
// so it is called directly rather than re-implemented.

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
