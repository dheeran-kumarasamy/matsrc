// Unit tests for the OTP delivery orchestration (email-only — SMS/MSG91 is
// currently disabled, see delivery.ts), with the email sender and
// recordDeliveryAttempt mocked — no real network/database calls.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { OtpChannel, OtpDeliveryStatus } from "@matsrc/db";

type SendOtpEmailResult = { ok: true } | { ok: false; error: string };
const sendOtpEmail = vi.fn(async (..._args: unknown[]): Promise<SendOtpEmailResult> => ({ ok: true }));
const recordDeliveryAttempt = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock("@/lib/contact-verification/email-sender", () => ({
  sendOtpEmail: (to: string, otp: string) => sendOtpEmail(to, otp),
}));
vi.mock("./challenge", () => ({
  recordDeliveryAttempt: (...args: unknown[]) => recordDeliveryAttempt(...args),
}));

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
