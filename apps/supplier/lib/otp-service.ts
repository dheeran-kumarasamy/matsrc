import {
  prisma,
  OtpPurpose,
  OtpChannel,
  OtpDeliveryStatus,
  issueOtpChallenge as sharedIssueOtpChallenge,
  verifyOtpChallenge as sharedVerifyOtpChallenge,
  recordOtpDeliveryAttempt,
  notifyLoginOtpWhatsApp,
} from "@matsrc/db";
import { parsePhoneNumber } from "libphonenumber-js";
import { sendOtpEmail } from "./otp-email-sender";

// Pre-live-review correction (parity gap identified against
// apps/web/lib/otp-service/rate-limit.ts's checkOtpSendRateLimit): the
// durable, per-scope MAX_SENDS_PER_WINDOW/SEND_WINDOW_MS protection inside
// issueOtpChallenge() (packages/db/lib/otp-challenge.ts) was already
// identical between Buyer and Supplier, but Buyer's send-otp route ALSO
// applies a supplementary, best-effort in-memory per-IP throttle before
// ever calling issueOtpChallenge() — Supplier's route did not. This is the
// SAME verbatim limiter (not a new rate-limiting mechanism), duplicated
// here rather than imported, since apps/web/lib/contact-verification/rate-limit.ts
// is Buyer-app-local code apps/supplier cannot import across the Next.js
// app boundary — mirrors the existing project convention of per-app
// in-memory limiters (each app's own instance, best-effort, not a shared
// guarantee — same documented limitation as the original).
const sendBuckets = new Map<string, number[]>();
const MAX_TRACKED_SEND_KEYS = 5000;
const MAX_SEND_CALLS_PER_IP_WINDOW = 20;
const SEND_IP_WINDOW_MS = 15 * 60_000;

export type OtpRateLimitResult = { allowed: boolean; remaining: number; retryAfterMs: number };

/** Best-effort, per-IP send-rate throttle — supplementary to the durable, per-scope limit in issueSupplierOtpChallenge(). */
export function checkSupplierOtpSendRateLimit(ip: string | null, now = Date.now()): OtpRateLimitResult {
  if (!ip) {
    return { allowed: true, remaining: MAX_SEND_CALLS_PER_IP_WINDOW, retryAfterMs: 0 };
  }

  if (sendBuckets.size > MAX_TRACKED_SEND_KEYS) {
    sendBuckets.clear();
  }

  const windowStart = now - SEND_IP_WINDOW_MS;
  const recent = (sendBuckets.get(ip) ?? []).filter((t) => t > windowStart);

  if (recent.length >= MAX_SEND_CALLS_PER_IP_WINDOW) {
    sendBuckets.set(ip, recent);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, Math.min(...recent) + SEND_IP_WINDOW_MS - now) };
  }

  recent.push(now);
  sendBuckets.set(ip, recent);
  return { allowed: true, remaining: MAX_SEND_CALLS_PER_IP_WINDOW - recent.length, retryAfterMs: 0 };
}

// apps/supplier's thin OTP service wrapper — NEW Supplier login OTP
// (WhatsApp primary / email fallback), reusing the SAME shared OtpChallenge
// lifecycle/table as the Buyer portal (packages/db/lib/otp-challenge.ts) and
// the SAME shared WhatsApp sender (packages/db/lib/login-otp-whatsapp-notification.ts)
// — per the task's explicit "prefer reuse over duplication" / "do NOT
// create a separate Supplier OTP database/table" requirement. There is
// exactly ONE OtpChallenge table and ONE WhatsApp send implementation;
// this file only adapts them to apps/supplier's own `prisma` singleton and
// route conventions, mirroring apps/web/lib/otp-service's public shape.

export { OtpPurpose };

/** Same default-country ('IN') normalization convention already used across this repo. */
export function normalizeSupplierPhone(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  try {
    const candidate = trimmed.startsWith("+") ? trimmed : `+91${trimmed.replace(/\D/g, "")}`;
    const parsed = parsePhoneNumber(candidate, "IN");
    if (parsed && parsed.isValid()) {
      return parsed.format("E.164");
    }
    return null;
  } catch {
    return null;
  }
}

export type IssueResult =
  | { ok: true; challengeId: string; otp: string; expiresAt: Date }
  | { ok: false; code: "COOLDOWN" | "RATE_LIMITED"; message: string; retryAfterMs?: number };

export async function issueSupplierOtpChallenge(params: {
  identifier: string;
  userId?: string | null;
  defaultChannel: "WHATSAPP" | "EMAIL";
}): Promise<IssueResult> {
  const result = await sharedIssueOtpChallenge(
    prisma as any,
    { purpose: OtpPurpose.LOGIN_OTP, identifier: params.identifier, userId: params.userId ?? null },
    { channel: params.defaultChannel, provider: "pending" }
  );
  if (!result.ok) return result;
  return { ok: true, challengeId: result.challengeId, otp: result.otp, expiresAt: result.expiresAt };
}

export type VerifyResult =
  | { ok: true; userId: string | null; identifier: string }
  | { ok: false; code: "NOT_FOUND" | "EXPIRED" | "INVALID_OTP" | "TOO_MANY_ATTEMPTS"; message: string };

export async function verifySupplierOtpChallenge(identifier: string, otp: string): Promise<VerifyResult> {
  return sharedVerifyOtpChallenge(prisma as any, { purpose: OtpPurpose.LOGIN_OTP, identifier }, otp);
}

export type WhatsAppDeliveryOutcome =
  | { ok: true; channel: "WHATSAPP"; maskedTarget: string }
  | { ok: false; code: "NO_WHATSAPP_NUMBER" | "WHATSAPP_SEND_FAILED"; message: string };

function maskPhone(phone: string): string {
  if (phone.length <= 6) return "***";
  const prefixLen = phone.startsWith("+") ? 3 : 2;
  const prefix = phone.slice(0, prefixLen);
  const last4 = phone.slice(-4);
  const maskedLen = Math.max(phone.length - prefixLen - 4, 4);
  return `${prefix} ${"*".repeat(maskedLen)}${last4}`;
}

/** Delivers via WhatsApp — same shared sender as the Buyer portal; never auto-falls-back to email. */
export async function deliverSupplierOtpViaWhatsApp(
  challengeId: string,
  whatsappNumber: string,
  otp: string
): Promise<WhatsAppDeliveryOutcome> {
  if (!whatsappNumber) {
    return { ok: false, code: "NO_WHATSAPP_NUMBER", message: "No WhatsApp-enabled number is available to send the OTP to." };
  }

  const result = await notifyLoginOtpWhatsApp(prisma as any, { challengeId, phone: whatsappNumber, otp });

  if (!result.success) {
    await recordOtpDeliveryAttempt(prisma as any, challengeId, {
      channel: OtpChannel.WHATSAPP,
      provider: "meta-whatsapp-cloud-api",
      status: OtpDeliveryStatus.FAILED,
      error: result.reason,
    });
    return { ok: false, code: "WHATSAPP_SEND_FAILED", message: "We couldn't send the OTP to WhatsApp." };
  }

  await recordOtpDeliveryAttempt(prisma as any, challengeId, {
    channel: OtpChannel.WHATSAPP,
    provider: "meta-whatsapp-cloud-api",
    status: OtpDeliveryStatus.SENT,
    providerMessageId: result.externalId || null,
  });

  return { ok: true, channel: "WHATSAPP", maskedTarget: maskPhone(whatsappNumber) };
}

export type EmailDeliveryOutcome =
  | { ok: true; channel: "EMAIL"; maskedTarget: string }
  | { ok: false; code: "NO_EMAIL_FALLBACK" | "EMAIL_SEND_FAILED"; message: string };

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 3))}@${domain}`;
}

/** Delivers via email — explicit fallback, never automatic. */
export async function deliverSupplierOtpViaEmail(challengeId: string, email: string | null, otp: string): Promise<EmailDeliveryOutcome> {
  if (!email) {
    return { ok: false, code: "NO_EMAIL_FALLBACK", message: "No registered email address is available to send the OTP to." };
  }

  const emailResult = await sendOtpEmail(email, otp);
  if (!emailResult.ok) {
    await recordOtpDeliveryAttempt(prisma as any, challengeId, {
      channel: OtpChannel.EMAIL,
      provider: "ses-smtp",
      status: OtpDeliveryStatus.FAILED,
      error: emailResult.error,
    });
    return { ok: false, code: "EMAIL_SEND_FAILED", message: "We could not send the OTP to your registered email. Please try again later." };
  }

  await recordOtpDeliveryAttempt(prisma as any, challengeId, {
    channel: OtpChannel.EMAIL,
    provider: "ses-smtp",
    status: OtpDeliveryStatus.SENT,
  });

  return { ok: true, channel: "EMAIL", maskedTarget: maskEmail(email) };
}
