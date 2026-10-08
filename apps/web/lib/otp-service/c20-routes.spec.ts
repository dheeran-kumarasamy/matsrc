// Route-level tests for C20 (Login OTP) send-otp / verify-otp — Prisma and
// the OTP delivery path are mocked (same pattern as
// lib/contact-verification/service.spec.ts); no real database/network
// calls. Placed under lib/ (not app/api/) so it matches this project's
// vitest.config.ts include pattern ("lib/**/*.spec.ts"), importing the
// actual route handlers via the "@/..." alias.

import { beforeEach, describe, expect, it, vi } from "vitest";

const userFindUnique = vi.fn();
const userFindFirst = vi.fn();
const userUpsert = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      // Pre-live-review correction: `phone` is no longer a unique field
      // (see schema.prisma) — the real route now looks up phone-based
      // identifiers via findFirst(), not findUnique(). Both are mocked so
      // this spec continues to reflect the actual call site exactly.
      findFirst: (...args: unknown[]) => userFindFirst(...args),
      upsert: (...args: unknown[]) => userUpsert(...args),
    },
  },
}));

const issueOtpChallenge = vi.fn();
const verifyOtpChallenge = vi.fn();
const deliverOtp = vi.fn();
const deliverOtpViaWhatsApp = vi.fn();
const checkOtpSendRateLimit = vi.fn((..._args: unknown[]) => ({ allowed: true, remaining: 10, retryAfterMs: 0 }));
const checkOtpVerifyRateLimit = vi.fn((..._args: unknown[]) => ({ allowed: true, remaining: 10, retryAfterMs: 0 }));

vi.mock("@/lib/otp-service", () => ({
  issueOtpChallenge: (...args: unknown[]) => issueOtpChallenge(...args),
  verifyOtpChallenge: (...args: unknown[]) => verifyOtpChallenge(...args),
  deliverOtp: (...args: unknown[]) => deliverOtp(...args),
  deliverOtpViaWhatsApp: (...args: unknown[]) => deliverOtpViaWhatsApp(...args),
  checkOtpSendRateLimit: (...args: unknown[]) => checkOtpSendRateLimit(...args),
  checkOtpVerifyRateLimit: (...args: unknown[]) => checkOtpVerifyRateLimit(...args),
}));

function makeRequest(body: unknown): any {
  return {
    json: async () => body,
    headers: new Headers(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  checkOtpSendRateLimit.mockReturnValue({ allowed: true, remaining: 10, retryAfterMs: 0 });
  checkOtpVerifyRateLimit.mockReturnValue({ allowed: true, remaining: 10, retryAfterMs: 0 });
});

describe("POST /api/auth/send-otp (C20)", () => {
  it("delivers via WhatsApp as the primary channel for a 'whatsapp' request", async () => {
    userFindFirst.mockResolvedValue({ id: "user-1", email: "builder@example.com", whatsappNumber: "+919000000000", phone: "+919000000000" });
    issueOtpChallenge.mockResolvedValue({ ok: true, challengeId: "c1", otp: "123456", expiresAt: new Date() });
    deliverOtpViaWhatsApp.mockResolvedValue({ ok: true, channel: "WHATSAPP", maskedTarget: "+91 ******0000" });

    const { POST } = await import("@/app/api/auth/send-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.channel).toBe("WHATSAPP");
    expect(data.message).toContain("WhatsApp");
    expect(deliverOtp).not.toHaveBeenCalled();
  });

  it("legacy 'phone' channel value is treated as a WhatsApp request", async () => {
    userFindFirst.mockResolvedValue({ id: "user-1", email: "builder@example.com", whatsappNumber: null, phone: "+919000000000" });
    issueOtpChallenge.mockResolvedValue({ ok: true, challengeId: "c1", otp: "123456", expiresAt: new Date() });
    deliverOtpViaWhatsApp.mockResolvedValue({ ok: true, channel: "WHATSAPP", maskedTarget: "+91 ******0000" });

    const { POST } = await import("@/app/api/auth/send-otp/route");
    const res = await POST(makeRequest({ channel: "phone", identifier: "9000000000" }));

    expect(res.status).toBe(200);
    expect(deliverOtpViaWhatsApp).toHaveBeenCalled();
  });

  it("fails honestly (never claims success) when WhatsApp delivery fails, and does NOT auto-fallback to email", async () => {
    userFindFirst.mockResolvedValue({ id: "user-1", email: "builder@example.com", whatsappNumber: "+919000000000", phone: "+919000000000" });
    issueOtpChallenge.mockResolvedValue({ ok: true, challengeId: "c1", otp: "123456", expiresAt: new Date() });
    deliverOtpViaWhatsApp.mockResolvedValue({ ok: false, code: "WHATSAPP_SEND_FAILED", message: "We couldn't send the OTP to WhatsApp." });

    const { POST } = await import("@/app/api/auth/send-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000" }));

    expect(res.status).toBe(503);
    expect(deliverOtp).not.toHaveBeenCalled();
  });

  it("explicit email fallback delivers via the existing email OTP service", async () => {
    userFindUnique.mockResolvedValue({ id: "user-1", email: "builder@example.com" });
    issueOtpChallenge.mockResolvedValue({ ok: true, challengeId: "c2", otp: "123456", expiresAt: new Date() });
    deliverOtp.mockResolvedValue({ ok: true, channel: "EMAIL", maskedTarget: "bu***@example.com" });

    const { POST } = await import("@/app/api/auth/send-otp/route");
    const res = await POST(makeRequest({ channel: "email", identifier: "builder@example.com" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.channel).toBe("EMAIL");
    expect(data.message).toContain("registered email");
    expect(deliverOtpViaWhatsApp).not.toHaveBeenCalled();
  });

  it("fails honestly when email delivery itself fails", async () => {
    userFindUnique.mockResolvedValue(null);
    issueOtpChallenge.mockResolvedValue({ ok: true, challengeId: "c1", otp: "123456", expiresAt: new Date() });
    deliverOtp.mockResolvedValue({ ok: false, code: "NO_EMAIL_FALLBACK", message: "no fallback" });

    const { POST } = await import("@/app/api/auth/send-otp/route");
    const res = await POST(makeRequest({ channel: "email", identifier: "builder@example.com" }));

    expect(res.status).toBe(503);
  });
});

describe("POST /api/auth/verify-otp (C20)", () => {
  it("accepts the correct OTP and creates/updates the user", async () => {
    verifyOtpChallenge.mockResolvedValue({ ok: true, userId: null, identifier: "builder@example.com" });
    userUpsert.mockResolvedValue({ email: "builder@example.com", name: "Builder" });

    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "email", identifier: "builder@example.com", otp: "123456" }));

    expect(res.status).toBe(200);
    expect(verifyOtpChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "LOGIN_OTP", identifier: "builder@example.com" }),
      "123456"
    );
  });

  it("rejects an incorrect OTP", async () => {
    verifyOtpChallenge.mockResolvedValue({ ok: false, code: "INVALID_OTP", message: "Incorrect OTP." });

    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "email", identifier: "builder@example.com", otp: "999999" }));

    expect(res.status).toBe(401);
    expect(userUpsert).not.toHaveBeenCalled();
  });

  it("rejects an expired OTP", async () => {
    verifyOtpChallenge.mockResolvedValue({ ok: false, code: "EXPIRED", message: "This OTP has expired." });

    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "email", identifier: "builder@example.com", otp: "123456" }));

    expect(res.status).toBe(400);
  });

  it("rejects a malformed (non-6-digit) OTP before even querying the challenge service", async () => {
    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "email", identifier: "builder@example.com", otp: "12" }));

    expect(res.status).toBe(400);
    expect(verifyOtpChallenge).not.toHaveBeenCalled();
  });
});
