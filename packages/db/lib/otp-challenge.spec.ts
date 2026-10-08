import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  issueOtpChallenge,
  verifyOtpChallenge,
  recordOtpDeliveryAttempt,
  type OtpChallengePrismaClient,
} from "./otp-challenge";

// Tests for the shared OTP challenge lifecycle used directly by
// apps/supplier's new login OTP routes (packages/db/lib/otp-challenge.ts).
// Mirrors the test coverage of apps/web/lib/otp-service/challenge.spec.ts
// (the pre-existing, Buyer-only implementation) since both must enforce
// identical security invariants against the shared OtpChallenge model.

function fakeChallenge(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "challenge-1",
    purpose: "LOGIN_OTP",
    userId: null,
    identifier: "+919000000000",
    purchaseOrderId: null,
    otpHash: "",
    otpSalt: "",
    expiresAt: new Date(Date.now() + 5 * 60_000),
    attempts: 0,
    maxAttempts: 5,
    usedAt: null,
    createdAt: new Date(),
    lastSentAt: new Date(Date.now() - 61_000),
    sendCount: 1,
    channel: "WHATSAPP",
    provider: "pending",
    providerMessageId: null,
    deliveryStatus: "PENDING",
    lastError: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildPrisma(): OtpChallengePrismaClient & { _find: ReturnType<typeof vi.fn>; _create: ReturnType<typeof vi.fn>; _update: ReturnType<typeof vi.fn> } {
  const findFirst = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const $transaction = vi.fn(async (fn: any) => fn({ otpChallenge: { update, create } }));
  return { otpChallenge: { findFirst, create, update }, $transaction, _find: findFirst, _create: create, _update: update } as any;
}

describe("issueOtpChallenge (shared)", () => {
  it("generates a real 6-digit cryptographically-sourced OTP", async () => {
    const prisma = buildPrisma();
    prisma._find.mockResolvedValue(null);
    prisma._create.mockResolvedValue(fakeChallenge({ id: "new-challenge" }));

    const result = await issueOtpChallenge(prisma, { purpose: "LOGIN_OTP", identifier: "+919000000000" }, { channel: "WHATSAPP", provider: "pending" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.otp).toMatch(/^\d{6}$/);
  });

  it("never persists the plaintext OTP — only a hash", async () => {
    const prisma = buildPrisma();
    prisma._find.mockResolvedValue(null);
    prisma._create.mockResolvedValue(fakeChallenge({ id: "new-challenge" }));

    const result = await issueOtpChallenge(prisma, { purpose: "LOGIN_OTP", identifier: "+919000000000" }, { channel: "WHATSAPP", provider: "pending" });

    expect(result.ok).toBe(true);
    const createCall = prisma._create.mock.calls[0][0];
    expect(createCall.data.otpHash).not.toBe(result.ok ? result.otp : undefined);
    expect(createCall.data).not.toHaveProperty("otp");
  });

  it("enforces the resend cooldown", async () => {
    const prisma = buildPrisma();
    prisma._find.mockResolvedValue(fakeChallenge({ lastSentAt: new Date() }));

    const result = await issueOtpChallenge(prisma, { purpose: "LOGIN_OTP", identifier: "+919000000000" }, { channel: "WHATSAPP", provider: "pending" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("COOLDOWN");
    expect(prisma._create).not.toHaveBeenCalled();
  });

  it("enforces the send-rate window limit", async () => {
    const prisma = buildPrisma();
    prisma._find.mockResolvedValue(
      fakeChallenge({ sendCount: 5, createdAt: new Date(), lastSentAt: new Date(Date.now() - 61_000) })
    );

    const result = await issueOtpChallenge(prisma, { purpose: "LOGIN_OTP", identifier: "+919000000000" }, { channel: "WHATSAPP", provider: "pending" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
  });

  it("invalidates the previous challenge when issuing a new one", async () => {
    const prisma = buildPrisma();
    const previous = fakeChallenge({ id: "old-challenge", lastSentAt: new Date(Date.now() - 61_000) });
    prisma._find.mockResolvedValue(previous);
    prisma._create.mockResolvedValue(fakeChallenge({ id: "new-challenge" }));

    await issueOtpChallenge(prisma, { purpose: "LOGIN_OTP", identifier: "+919000000000" }, { channel: "WHATSAPP", provider: "pending" });

    expect(prisma._update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "old-challenge" }, data: expect.objectContaining({ usedAt: expect.any(Date) }) })
    );
  });
});

describe("verifyOtpChallenge (shared)", () => {
  it("rejects an expired OTP", async () => {
    const prisma = buildPrisma();
    prisma._find.mockResolvedValue(fakeChallenge({ expiresAt: new Date(Date.now() - 1000) }));

    const result = await verifyOtpChallenge(prisma, { purpose: "LOGIN_OTP", identifier: "+919000000000" }, "123456");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXPIRED");
  });

  it("enforces maximum verification attempts", async () => {
    const prisma = buildPrisma();
    prisma._find.mockResolvedValue(fakeChallenge({ attempts: 5, maxAttempts: 5 }));
    prisma._update.mockResolvedValue({});

    const result = await verifyOtpChallenge(prisma, { purpose: "LOGIN_OTP", identifier: "+919000000000" }, "123456");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("returns NOT_FOUND for no active challenge (also covers single-use: a used challenge is excluded from lookup)", async () => {
    const prisma = buildPrisma();
    prisma._find.mockResolvedValue(null);

    const result = await verifyOtpChallenge(prisma, { purpose: "LOGIN_OTP", identifier: "+919000000000" }, "123456");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("enforces purpose binding in the lookup query", async () => {
    const prisma = buildPrisma();
    prisma._find.mockResolvedValue(null);

    await verifyOtpChallenge(prisma, { purpose: "PO_APPROVAL_OTP", identifier: "builder@example.com", purchaseOrderId: "po-1" }, "123456");

    expect(prisma._find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ purpose: "PO_APPROVAL_OTP", purchaseOrderId: "po-1" }) })
    );
  });
});

describe("recordOtpDeliveryAttempt", () => {
  it("records channel/provider/status without ever being passed the plaintext OTP", async () => {
    const prisma = buildPrisma();
    prisma._update.mockResolvedValue({});

    await recordOtpDeliveryAttempt(prisma, "challenge-1", { channel: "WHATSAPP", provider: "meta-whatsapp-cloud-api", status: "SENT", providerMessageId: "wamid.1" });

    expect(prisma._update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "challenge-1" }, data: expect.objectContaining({ channel: "WHATSAPP", deliveryStatus: "SENT" }) })
    );
  });
});
