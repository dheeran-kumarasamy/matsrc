// Route-level tests for the NEW Supplier portal login OTP (WhatsApp primary
// / email fallback) — send-otp / verify-otp. Prisma and the OTP service are
// mocked (same pattern as apps/web's c20-routes.spec.ts); no real
// database/network calls. Placed under lib/ to match this project's
// vitest.config.ts include pattern ("lib/**/*.spec.ts").

import { beforeEach, describe, expect, it, vi } from "vitest";

const userFindUnique = vi.fn();
const userFindFirst = vi.fn();
const userUpsert = vi.fn();

vi.mock("@matsrc/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      // Pre-live-review correction: `phone` is no longer a unique field
      // (see packages/db/prisma/schema.prisma) — the real route now looks
      // up phone-based identifiers via findFirst(), not findUnique().
      findFirst: (...args: unknown[]) => userFindFirst(...args),
      upsert: (...args: unknown[]) => userUpsert(...args),
    },
  },
  // Real Prisma enum value — the route scopes its findFirst() by
  // role: Role.SUPPLIER, so the mock must provide a real Role export.
  Role: { BUILDER: "BUILDER", SUPPLIER: "SUPPLIER", ADMIN: "ADMIN", SUPER_ADMIN: "SUPER_ADMIN" },
}));

const issueSupplierOtpChallenge = vi.fn();
const verifySupplierOtpChallenge = vi.fn();
const deliverSupplierOtpViaWhatsApp = vi.fn();
const deliverSupplierOtpViaEmail = vi.fn();
const normalizeSupplierPhone = vi.fn((phone: string) => (phone === "9000000000" ? "+919000000000" : null));
const checkSupplierOtpSendRateLimit = vi.fn((..._args: unknown[]) => ({ allowed: true, remaining: 10, retryAfterMs: 0 }));

vi.mock("@/lib/otp-service", () => ({
  issueSupplierOtpChallenge: (...args: unknown[]) => issueSupplierOtpChallenge(...args),
  verifySupplierOtpChallenge: (...args: unknown[]) => verifySupplierOtpChallenge(...args),
  deliverSupplierOtpViaWhatsApp: (...args: unknown[]) => deliverSupplierOtpViaWhatsApp(...args),
  deliverSupplierOtpViaEmail: (...args: unknown[]) => deliverSupplierOtpViaEmail(...args),
  normalizeSupplierPhone: (...args: unknown[]) => normalizeSupplierPhone(...(args as [string])),
  checkSupplierOtpSendRateLimit: (...args: unknown[]) => checkSupplierOtpSendRateLimit(...args),
}));

function makeRequest(body: unknown): any {
  return { json: async () => body, headers: new Headers() };
}

beforeEach(() => {
  vi.clearAllMocks();
  normalizeSupplierPhone.mockImplementation((phone: string) => (phone === "9000000000" ? "+919000000000" : null));
  checkSupplierOtpSendRateLimit.mockReturnValue({ allowed: true, remaining: 10, retryAfterMs: 0 });
});

describe("POST /api/auth/send-otp (Supplier)", () => {
  it("delivers via WhatsApp as the primary channel", async () => {
    userFindFirst.mockResolvedValue({ id: "u1", email: "s@example.com", whatsappNumber: "+919000000000", phone: "+919000000000" });
    issueSupplierOtpChallenge.mockResolvedValue({ ok: true, challengeId: "c1", otp: "123456", expiresAt: new Date() });
    deliverSupplierOtpViaWhatsApp.mockResolvedValue({ ok: true, channel: "WHATSAPP", maskedTarget: "+91 ******0000" });

    const { POST } = await import("@/app/api/auth/send-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.channel).toBe("WHATSAPP");
    expect(deliverSupplierOtpViaEmail).not.toHaveBeenCalled();
  });

  it("fails honestly when WhatsApp delivery fails and does NOT auto-fallback to email", async () => {
    userFindFirst.mockResolvedValue({ id: "u1", email: "s@example.com", whatsappNumber: "+919000000000", phone: "+919000000000" });
    issueSupplierOtpChallenge.mockResolvedValue({ ok: true, challengeId: "c1", otp: "123456", expiresAt: new Date() });
    deliverSupplierOtpViaWhatsApp.mockResolvedValue({ ok: false, code: "WHATSAPP_SEND_FAILED", message: "We couldn't send the OTP to WhatsApp." });

    const { POST } = await import("@/app/api/auth/send-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000" }));

    expect(res.status).toBe(503);
    expect(deliverSupplierOtpViaEmail).not.toHaveBeenCalled();
  });

  it("explicit email fallback delivers via the email OTP service", async () => {
    userFindUnique.mockResolvedValue({ id: "u1", email: "s@example.com" });
    issueSupplierOtpChallenge.mockResolvedValue({ ok: true, challengeId: "c2", otp: "123456", expiresAt: new Date() });
    deliverSupplierOtpViaEmail.mockResolvedValue({ ok: true, channel: "EMAIL", maskedTarget: "s***@example.com" });

    const { POST } = await import("@/app/api/auth/send-otp/route");
    const res = await POST(makeRequest({ channel: "email", identifier: "s@example.com" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.channel).toBe("EMAIL");
    expect(deliverSupplierOtpViaWhatsApp).not.toHaveBeenCalled();
  });

  it("rejects an invalid WhatsApp number before issuing any challenge", async () => {
    const { POST } = await import("@/app/api/auth/send-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "not-a-phone" }));

    expect(res.status).toBe(400);
    expect(issueSupplierOtpChallenge).not.toHaveBeenCalled();
  });

  it("surfaces resend-cooldown/rate-limit denials from issueSupplierOtpChallenge", async () => {
    userFindUnique.mockResolvedValue(null);
    issueSupplierOtpChallenge.mockResolvedValue({ ok: false, code: "COOLDOWN", message: "Please wait before requesting another OTP." });

    const { POST } = await import("@/app/api/auth/send-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000" }));

    expect(res.status).toBe(429);
  });

  it("rejects when the per-IP send rate limit is exceeded, before ever issuing a challenge (parity with Buyer)", async () => {
    checkSupplierOtpSendRateLimit.mockReturnValue({ allowed: false, remaining: 0, retryAfterMs: 60000 });

    const { POST } = await import("@/app/api/auth/send-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000" }));

    expect(res.status).toBe(429);
    expect(issueSupplierOtpChallenge).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/verify-otp (Supplier)", () => {
  it("accepts the correct OTP and creates a User + SupplierProfile", async () => {
    verifySupplierOtpChallenge.mockResolvedValue({ ok: true, userId: null, identifier: "+919000000000" });
    userUpsert.mockResolvedValue({ email: "9000000000@phone.buildohub.in", name: null });

    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000", otp: "123456" }));

    expect(res.status).toBe(200);
    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: "SUPPLIER", supplierProfile: expect.objectContaining({ create: expect.anything() }) }),
      })
    );
  });

  it("rejects an incorrect OTP without creating a user", async () => {
    verifySupplierOtpChallenge.mockResolvedValue({ ok: false, code: "INVALID_OTP", message: "Incorrect OTP." });

    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000", otp: "999999" }));

    expect(res.status).toBe(401);
    expect(userUpsert).not.toHaveBeenCalled();
  });

  it("rejects an expired OTP", async () => {
    verifySupplierOtpChallenge.mockResolvedValue({ ok: false, code: "EXPIRED", message: "This OTP has expired." });

    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000", otp: "123456" }));

    expect(res.status).toBe(400);
  });

  it("rejects a malformed (non-6-digit) OTP before querying the challenge service", async () => {
    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000", otp: "12" }));

    expect(res.status).toBe(400);
    expect(verifySupplierOtpChallenge).not.toHaveBeenCalled();
  });
});
