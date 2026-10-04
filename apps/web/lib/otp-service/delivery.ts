import { OtpChannel, OtpDeliveryStatus } from "@matsrc/db";
import { sendOtpEmail } from "@/lib/contact-verification/email-sender";
import { Msg91SmsProvider } from "./providers/msg91-sms.provider";
import type { SmsOtpProvider } from "./providers/sms-provider.interface";
import { recordDeliveryAttempt } from "./challenge";

// Delivery orchestration for OTP challenges — owns provider selection
// (MSG91 SMS stub -> SES email fallback) but NEVER owns OTP
// generation/storage/verification (see ./challenge.ts), per the task spec's
// "the delivery provider must NOT own OTP verification" requirement.
//
// Reuses the EXISTING, already-wired sendOtpEmail() (nodemailer over SES
// SMTP) from apps/web/lib/contact-verification/email-sender.ts as-is —
// this is the one genuinely working delivery mechanism per the task spec,
// so it is called directly rather than re-implemented.

const smsProvider: SmsOtpProvider = new Msg91SmsProvider();

export type DeliveryTarget = {
  // The phone number to attempt SMS delivery to, if any (normalized E.164).
  phone?: string | null;
  // The email address to use for email delivery/fallback, if any (normalized).
  email?: string | null;
};

export type DeliveryOutcome =
  | { ok: true; channel: "SMS" | "EMAIL"; maskedTarget: string }
  | {
      ok: false;
      // SMS was stubbed/unavailable AND there was no usable email to fall
      // back to — an honest, actionable failure (never a fake success).
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
 * Attempts delivery of `otp` using the configured channel strategy:
 *   1. If a phone number is available, try MSG91 SMS first (currently always
 *      reports NOT_CONFIGURED — see Msg91SmsProvider).
 *   2. On SMS unavailability/failure, fall back to SES email IF an eligible
 *      email address is available.
 *   3. If neither channel can deliver, return an honest failure — never a
 *      fabricated "sent" result.
 *
 * Every attempt (including the stubbed SMS "attempt") is recorded against
 * `challengeId` via recordDeliveryAttempt() for observability — without
 * ever persisting the plaintext OTP or any provider secret.
 */
export async function deliverOtp(
  challengeId: string,
  target: DeliveryTarget,
  otp: string
): Promise<DeliveryOutcome> {
  if (target.phone) {
    const smsResult = await smsProvider.sendOtp(target.phone, otp);

    if (smsResult.status === "SENT") {
      await recordDeliveryAttempt(challengeId, {
        channel: OtpChannel.SMS,
        provider: smsProvider.providerName,
        status: OtpDeliveryStatus.SENT,
        providerMessageId: smsResult.providerMessageId,
      });
      return { ok: true, channel: "SMS", maskedTarget: maskPhoneForDisplay(target.phone) };
    }

    // NOT_CONFIGURED (stub) or FAILED — record honestly, never as SENT.
    await recordDeliveryAttempt(challengeId, {
      channel: OtpChannel.SMS,
      provider: smsProvider.providerName,
      status: smsResult.status === "NOT_CONFIGURED" ? OtpDeliveryStatus.NOT_CONFIGURED : OtpDeliveryStatus.FAILED,
      error: smsResult.status === "NOT_CONFIGURED" ? smsResult.reason : smsResult.error,
    });
  }

  if (!target.email) {
    return {
      ok: false,
      code: "NO_EMAIL_FALLBACK",
      message:
        "SMS delivery is currently unavailable and no registered email address is available to send the OTP to.",
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

function maskPhoneForDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `+${"*".repeat(Math.max(digits.length - 4, 3))}${digits.slice(-4)}`;
}
