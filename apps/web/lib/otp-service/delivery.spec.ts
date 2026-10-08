// Unit tests for the OTP delivery orchestration (email-only — SMS/MSG91 is
// currently disabled, see delivery.ts), with the email sender and
// recordDeliveryAttempt mocked — no real network/database calls.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { OtpChannel, OtpDeliveryStatus } from "@matsrc/db";

type SendOtpEmailResult = { ok: true } | { ok: false; error: string };
const sendOtpEmail = vi.fn(async (..._args: unknown[]): Promise<SendOtpEmailResult> => ({ ok: true }));
const recordDeliveryAttempt = vi.fn(async (..._args: unknown[]) => undefined);
type NotifyLoginOtpWhatsAppResult = { success: true; externalId: string } | { success: false; reason: string };
const notifyLoginOtpWhatsApp = vi.fn(
  async (..._args: unknown[]): Promise<NotifyLoginOtpWhatsAppResult> => ({ success: true, externalId: "mock-id" })
);

vi.mock("@/lib/contact-verification/email-sender", () => ({
  sendOtpEmail: (to: string, otp: string) => sendOtpEmail(to, otp),
}));
vi.mock("./challenge", () => ({
  recordDeliveryAttempt: (...args: unknown[]) => recordDeliveryAttempt(...args),
}));
// delivery.ts's WhatsApp path imports the real @matsrc/db `prisma` singleton
// via @/lib/builder-db purely to pass it through as an opaque client to
// notifyLoginOtpWhatsApp() (mocked below) — it never queries Prisma
// directly here, so a minimal stub object is sufficient and avoids pulling
// in the real builder-db.ts -> auth.ts -> next-auth import chain in tests.
vi.mock("@/lib/builder-db", () => ({ prisma: {} }));
vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    notifyLoginOtpWhatsApp: (...args: unknown[]) => notifyLoginOtpWhatsApp(...args),
  };
});

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("deliverOtp", () => {
  it("sends via email even when a phone number is present — SMS/MSG91 is disabled", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USERNAME = "user";
    process.env.SMTP_PASSWORD = "pass";

    const { deliverOtp } = await import("./delivery");
    const result = await deliverOtp("challenge-1", { phone: "+919000000000", email: "builder@example.com" }, "123456");

    expect(sendOtpEmail).toHaveBeenCalledWith("builder@example.com", "123456");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.channel).toBe("EMAIL");

    // No SMS delivery attempt is ever recorded.
    expect(recordDeliveryAttempt).not.toHaveBeenCalledWith(
      "challenge-1",
      expect.objectContaining({ channel: OtpChannel.SMS })
    );
  });

  it("fails honestly when there is no email on file (phone alone is never sufficient)", async () => {
    const { deliverOtp } = await import("./delivery");
    const result = await deliverOtp("challenge-1", { phone: "+919000000000", email: null }, "123456");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_EMAIL_FALLBACK");
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("fails honestly (never a fake success) when SMTP is not configured", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USERNAME;
    delete process.env.SMTP_PASSWORD;

    const { deliverOtp } = await import("./delivery");
    const result = await deliverOtp("challenge-1", { email: "builder@example.com" }, "123456");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMAIL_SEND_FAILED");
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("surfaces a real SES send failure correctly rather than reporting success", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USERNAME = "user";
    process.env.SMTP_PASSWORD = "pass";
    sendOtpEmail.mockResolvedValueOnce({ ok: false, error: "SMTP connection refused" });

    const { deliverOtp } = await import("./delivery");
    const result = await deliverOtp("challenge-1", { email: "builder@example.com" }, "123456");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("EMAIL_SEND_FAILED");
      // Internal SMTP error details are never exposed in the user-facing message.
      expect(result.message).not.toContain("SMTP connection refused");
    }
  });

  it("never logs/returns the plaintext OTP in the delivery outcome", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USERNAME = "user";
    process.env.SMTP_PASSWORD = "pass";

    const { deliverOtp } = await import("./delivery");
    const result = await deliverOtp("challenge-1", { email: "builder@example.com" }, "123456");

    expect(JSON.stringify(result)).not.toContain("123456");
  });
});

describe("deliverOtpViaWhatsApp", () => {
  it("delivers via WhatsApp and records SENT on success", async () => {
    notifyLoginOtpWhatsApp.mockResolvedValueOnce({ success: true, externalId: "wamid.ABC" });

    const { deliverOtpViaWhatsApp } = await import("./delivery");
    const result = await deliverOtpViaWhatsApp("challenge-1", "+919000000000", "123456");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.channel).toBe("WHATSAPP");
      expect(result.maskedTarget).not.toBe("+919000000000");
    }
    expect(recordDeliveryAttempt).toHaveBeenCalledWith(
      "challenge-1",
      expect.objectContaining({ channel: OtpChannel.WHATSAPP, status: OtpDeliveryStatus.SENT, providerMessageId: "wamid.ABC" })
    );
  });

  it("fails honestly (never a fake success) when the WhatsApp send fails, and records FAILED", async () => {
    notifyLoginOtpWhatsApp.mockResolvedValueOnce({ success: false, reason: "TEMPLATE_NOT_FOUND" });

    const { deliverOtpViaWhatsApp } = await import("./delivery");
    const result = await deliverOtpViaWhatsApp("challenge-1", "+919000000000", "123456");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("WHATSAPP_SEND_FAILED");
    expect(recordDeliveryAttempt).toHaveBeenCalledWith(
      "challenge-1",
      expect.objectContaining({ channel: OtpChannel.WHATSAPP, status: OtpDeliveryStatus.FAILED })
    );
  });

  it("fails honestly when no WhatsApp number is available, without ever calling the sender", async () => {
    const { deliverOtpViaWhatsApp } = await import("./delivery");
    const result = await deliverOtpViaWhatsApp("challenge-1", "", "123456");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_WHATSAPP_NUMBER");
    expect(notifyLoginOtpWhatsApp).not.toHaveBeenCalled();
  });

  it("never logs/returns the plaintext OTP in the WhatsApp delivery outcome", async () => {
    notifyLoginOtpWhatsApp.mockResolvedValueOnce({ success: true, externalId: "wamid.ABC" });

    const { deliverOtpViaWhatsApp } = await import("./delivery");
    const result = await deliverOtpViaWhatsApp("challenge-1", "+919000000000", "123456");

    expect(JSON.stringify(result)).not.toContain("123456");
  });

  it("masks the phone number rather than exposing it in full", async () => {
    notifyLoginOtpWhatsApp.mockResolvedValueOnce({ success: true, externalId: "wamid.ABC" });

    const { deliverOtpViaWhatsApp } = await import("./delivery");
    const result = await deliverOtpViaWhatsApp("challenge-1", "+919000009167", "123456");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.maskedTarget).toContain("9167");
      expect(result.maskedTarget).not.toBe("+919000009167");
    }
  });
});
