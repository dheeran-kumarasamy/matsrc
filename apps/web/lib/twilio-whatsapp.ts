import Twilio from "twilio";

// Minimal, best-effort Twilio WhatsApp sender used by apps/web/lib/notify.ts.
// Mirrors the env-var contract already established in apps/api (WHATSAPP_ENABLED,
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER) so the same
// Twilio Sandbox credentials work across both the NestJS API and this Next.js app.
// Deliberately lightweight (no adapter interface/DI) since this app already writes
// Notification rows directly via Prisma rather than routing through the NestJS API.

let client: ReturnType<typeof Twilio> | null = null;

function getClient(): ReturnType<typeof Twilio> {
  if (client) return client;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured");
  }
  client = Twilio(accountSid, authToken);
  return client;
}

function toWhatsAppAddress(raw: string): string {
  return raw.startsWith("whatsapp:") ? raw : `whatsapp:${raw}`;
}

export type TwilioSendResult = { externalId: string; provider: string } | { error: string };

/**
 * Sends a free-form WhatsApp message via Twilio. Returns `{ error }` (never throws)
 * if WHATSAPP_ENABLED isn't "true", Twilio isn't configured, or the send fails —
 * callers should fall back to a "failed" Notification status rather than blocking
 * the calling business operation.
 */
export async function sendWhatsAppMessage(to: string, body: string): Promise<TwilioSendResult> {
  if (process.env.WHATSAPP_ENABLED !== "true") {
    return { error: "WhatsApp sending is disabled (WHATSAPP_ENABLED is not \"true\")" };
  }

  try {
    const from = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";
    const message = await getClient().messages.create({
      to: toWhatsAppAddress(to),
      from: toWhatsAppAddress(from),
      body,
    });

    return { externalId: message.sid, provider: "twilio-whatsapp" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Twilio WhatsApp send failed";
    console.error("Twilio WhatsApp send failed:", message);
    return { error: message };
  }
}
