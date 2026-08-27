import Twilio from "twilio";

// Sends the OTP verification SMS for the /profile "change phone" flow.
//
// PROVIDER: reuses the SAME Twilio account already configured for WhatsApp
// sends in this app (apps/web/lib/twilio-whatsapp.ts — TWILIO_ACCOUNT_SID /
// TWILIO_AUTH_TOKEN), rather than introducing a new SMS provider (e.g.
// MSG91, whose env vars are declared in .env.example but never wired up to
// any code). Twilio supports plain SMS via the same account/credentials
// used for WhatsApp — only a distinct "from" number is needed.
//
// Required environment variables (documented in .env.example):
//   TWILIO_ACCOUNT_SID   — already used by twilio-whatsapp.ts, reused as-is.
//   TWILIO_AUTH_TOKEN    — already used by twilio-whatsapp.ts, reused as-is.
//   TWILIO_SMS_FROM_NUMBER — a Twilio phone number enabled for SMS sending
//                            (distinct from TWILIO_WHATSAPP_NUMBER, which is
//                            a `whatsapp:`-prefixed sandbox/business number
//                            and cannot send plain SMS).
//   SMS_OTP_ENABLED      — set to "true" to enable real sends; mirrors the
//                          existing WHATSAPP_ENABLED convention. Defaults to
//                          disabled so this never sends real SMS in
//                          dev/test/CI by accident.
//
// If disabled/unconfigured, sends are logged (never the OTP itself) and
// treated as a soft success so the profile page's OTP flow remains testable
// without real credentials — mirroring sendWhatsAppMessage's behaviour.

let client: ReturnType<typeof Twilio> | null = null;

function getClient(): ReturnType<typeof Twilio> | null {
  if (client) return client;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  client = Twilio(accountSid, authToken);
  return client;
}

export type SmsSendResult = { ok: true } | { ok: false; error: string };

/**
 * Sends the OTP code to `toPhoneE164`. NEVER logs the OTP value itself
 * (task spec §4 "Never log OTP values") — only the fact that a send was
 * attempted/succeeded/failed.
 */
export async function sendOtpSms(toPhoneE164: string, otp: string): Promise<SmsSendResult> {
  const body = `Your BuildOHub verification code is ${otp}. It expires in 10 minutes.`;

  if (process.env.SMS_OTP_ENABLED !== "true") {
    console.log(`[contact-verification] SMS_OTP_ENABLED is not "true" — would send SMS OTP to ${maskLogTarget(toPhoneE164)}`);
    return { ok: true };
  }

  const from = process.env.TWILIO_SMS_FROM_NUMBER;
  const twilioClient = getClient();
  if (!twilioClient || !from) {
    console.error("[contact-verification] SMS_OTP_ENABLED is true but Twilio SMS is not fully configured (missing TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_SMS_FROM_NUMBER)");
    return { ok: false, error: "SMS provider not configured" };
  }

  try {
    await twilioClient.messages.create({ to: toPhoneE164, from, body });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMS send failed";
    console.error(`[contact-verification] Failed to send SMS OTP to ${maskLogTarget(toPhoneE164)}:`, message);
    return { ok: false, error: message };
  }
}

function maskLogTarget(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}
