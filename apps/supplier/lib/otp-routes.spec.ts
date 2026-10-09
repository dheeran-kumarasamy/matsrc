// Route-level tests for the NEW Supplier portal login OTP (WhatsApp primary
// / email fallback) — send-otp / verify-otp. Prisma and the OTP service are
// mocked (same pattern as apps/web's c20-routes.spec.ts); no real
// database/network calls. Placed under lib/ to match this project's
// vitest.config.ts include pattern ("lib/**/*.spec.ts").

import { beforeEach, describe, expect, it, vi } from "vitest";

const userFindUnique = vi.fn();
const userFindFirst = vi.fn();
const userCreate = vi.fn();
const userFindUniqueOrThrow = vi.fn();

// Unified Account Identity: the real routes now resolve/link through
// @matsrc/db's identity-resolution layer (unit-tested separately in
// packages/db/lib/identity-resolution.spec.ts). These mocks reproduce its
// observable behavior closely enough for route-level assertions: no
// AuthIdentity exists yet by default, so resolveOrLinkIdentity falls
// through to candidateUserId (legacy lookup) or createUser().
const findIdentity = vi.fn(async (..._args: any[]) => null as any);
const detectCrossIdentityConflict = vi.fn(async (..._args: any[]) => null as any);
const resolveOrLinkIdentity = vi.fn(async (_prisma: any, _scope: any, options: any) => {
  if (options.candidateUserId) return { status: "LINKED_EXISTING", userId: options.candidateUserId };
  const user = await options.createUser();
  return { status: "CREATED_NEW", userId: user.id };
});
const resolveCrossRoleSafeEmail = vi.fn(async (_prisma: any, email: string, ..._rest: any[]) => email);

vi.mock("@matsrc/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      // Pre-live-review correction: `phone` is no longer a unique field
      // (see packages/db/prisma/schema.prisma) — the real route now looks
      // up phone-based identifiers via findFirst(), not findUnique().
      findFirst: (...args: unknown[]) => userFindFirst(...args),
      create: (...args: unknown[]) => userCreate(...args),
      findUniqueOrThrow: (...args: unknown[]) => userFindUniqueOrThrow(...args),
    },
  },
  // Real Prisma enum value — the route scopes its findFirst() by
  // role: Role.SUPPLIER, so the mock must provide a real Role export.
  Role: { BUILDER: "BUILDER", SUPPLIER: "SUPPLIER", ADMIN: "ADMIN", SUPER_ADMIN: "SUPER_ADMIN" },
  findIdentity: (...args: unknown[]) => findIdentity(...(args as [any, any])),
  detectCrossIdentityConflict: (...args: unknown[]) => detectCrossIdentityConflict(...(args as [any, any, any])),
  resolveOrLinkIdentity: (...args: unknown[]) => resolveOrLinkIdentity(...(args as [any, any, any])),
  resolveCrossRoleSafeEmail: (...args: unknown[]) => resolveCrossRoleSafeEmail(...(args as [any, any, any])),
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
    userFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "user-1", email: "9000000000@supplier.phone.buildohub.in", name: null });
    userFindUniqueOrThrow.mockResolvedValue({ id: "user-1", email: "9000000000@supplier.phone.buildohub.in", name: null });

    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000", otp: "123456" }));

    expect(res.status).toBe(200);
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "SUPPLIER", supplierProfile: expect.objectContaining({ create: expect.anything() }) }),
      })
    );
  });

  it("rejects an incorrect OTP without creating a user", async () => {
    verifySupplierOtpChallenge.mockResolvedValue({ ok: false, code: "INVALID_OTP", message: "Incorrect OTP." });

    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000", otp: "999999" }));

    expect(res.status).toBe(401);
    expect(userCreate).not.toHaveBeenCalled();
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

describe("POST /api/auth/verify-otp (Supplier) — Unified Account Identity", () => {
  it("WhatsApp login for an already-known phone links to the pre-existing placeholder-email User instead of creating a second one", async () => {
    verifySupplierOtpChallenge.mockResolvedValue({ ok: true, userId: null, identifier: "+919000000000" });
    userFindUnique.mockResolvedValue({ id: "sup-user-1", role: "SUPPLIER", email: "9000000000@supplier.phone.buildohub.in" });
    userFindUniqueOrThrow.mockResolvedValue({ id: "sup-user-1", email: "9000000000@supplier.phone.buildohub.in", name: null });

    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "whatsapp", identifier: "9000000000", otp: "123456" }));

    expect(res.status).toBe(200);
    expect(userCreate).not.toHaveBeenCalled();
    expect(resolveOrLinkIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: "WHATSAPP", role: "SUPPLIER" }),
      expect.objectContaining({ candidateUserId: "sup-user-1" })
    );
  });

  it("ignores a legacy email match that belongs to a BUILDER (Buyer) User — never resolves Supplier login to a Buyer account", async () => {
    verifySupplierOtpChallenge.mockResolvedValue({ ok: true, userId: null, identifier: "shared@example.com" });
    userFindUnique.mockResolvedValue({ id: "buyer-user-1", role: "BUILDER", email: "shared@example.com" });
    userCreate.mockResolvedValue({ id: "new-sup-user", email: "shared@example.com", name: null });
    userFindUniqueOrThrow.mockResolvedValue({ id: "new-sup-user", email: "shared@example.com", name: null });

    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "email", identifier: "shared@example.com", otp: "123456" }));

    expect(res.status).toBe(200);
    expect(resolveOrLinkIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ candidateUserId: null })
    );
  });

  it("returns a safe 409 conflict instead of silently merging when the identity is already linked to a DIFFERENT User", async () => {
    verifySupplierOtpChallenge.mockResolvedValue({ ok: true, userId: null, identifier: "supplier@example.com" });
    userFindUnique.mockResolvedValue({ id: "sup-user-A", role: "SUPPLIER", email: "supplier@example.com" });
    detectCrossIdentityConflict.mockResolvedValue({ code: "IDENTITY_CONFLICT", message: "conflict" });

    const { POST } = await import("@/app/api/auth/verify-otp/route");
    const res = await POST(makeRequest({ channel: "email", identifier: "supplier@example.com", otp: "123456" }));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.code).toBe("IDENTITY_CONFLICT");
    expect(resolveOrLinkIdentity).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });
});
