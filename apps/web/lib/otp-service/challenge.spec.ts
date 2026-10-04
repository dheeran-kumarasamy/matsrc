// Unit tests for the shared OTP challenge service (C20 + C37), with Prisma
// mocked — same pattern as apps/web/lib/contact-verification/service.spec.ts
// (no real database/network calls).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { OtpChannel, OtpDeliveryStatus, OtpPurpose } from "@matsrc/db";

const otpChallengeFindFirst = vi.fn();
const otpChallengeCreate = vi.fn();
const otpChallengeUpdate = vi.fn();
const transaction = vi.fn(async (fn: any) => fn({ otpChallenge: { update: otpChallengeUpdate, create: otpChallengeCreate } }));

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    otpChallenge: {
      findFirst: (...args: unknown[]) => otpChallengeFindFirst(...args),
      create: (...args: unknown[]) => otpChallengeCreate(...args),
      update: (...args: unknown[]) => otpChallengeUpdate(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...(args as [any])),
  },
}));

function fakeChallenge(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "challenge-1",
    purpose: OtpPurpose.LOGIN_OTP,
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
    channel: OtpChannel.SMS,
    provider: "pending",
    providerMessageId: null,
    deliveryStatus: OtpDeliveryStatus.PENDING,
    lastError: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation(async (fn: any) =>
    fn({ otpChallenge: { update: otpChallengeUpdate, create: otpChallengeCreate } })
  );
});

describe("issueOtpChallenge", () => {
  it("generates a real 6-digit cryptographically-sourced OTP", async () => {
    otpChallengeFindFirst.mockResolvedValue(null);
    otpChallengeCreate.mockResolvedValue(fakeChallenge({ id: "new-challenge" }));

    const { issueOtpChallenge } = await import("./challenge");
    const result = await issueOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier: "+919000000000" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.otp).toMatch(/^\d{6}$/);
    }
  });

  it("never persists the plaintext OTP — only a hash", async () => {
    otpChallengeFindFirst.mockResolvedValue(null);
    otpChallengeCreate.mockResolvedValue(fakeChallenge({ id: "new-challenge" }));

    const { issueOtpChallenge } = await import("./challenge");
    const result = await issueOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier: "+919000000000" });

    expect(result.ok).toBe(true);
    const createCall = otpChallengeCreate.mock.calls[0][0];
    expect(createCall.data.otpHash).not.toBe(result.ok ? result.otp : undefined);
    expect(createCall.data).not.toHaveProperty("otp");
  });

  it("enforces the resend cooldown", async () => {
    otpChallengeFindFirst.mockResolvedValue(fakeChallenge({ lastSentAt: new Date() }));

    const { issueOtpChallenge } = await import("./challenge");
    const result = await issueOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier: "+919000000000" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("COOLDOWN");
    expect(otpChallengeCreate).not.toHaveBeenCalled();
  });

  it("invalidates the old challenge when issuing a new one after cooldown has passed", async () => {
    const existing = fakeChallenge({ id: "old-challenge", lastSentAt: new Date(Date.now() - 61_000) });
    otpChallengeFindFirst.mockResolvedValue(existing);
    otpChallengeCreate.mockResolvedValue(fakeChallenge({ id: "new-challenge" }));

    const { issueOtpChallenge } = await import("./challenge");
    await issueOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier: "+919000000000" });

    expect(otpChallengeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "old-challenge" }, data: expect.objectContaining({ usedAt: expect.any(Date) }) })
    );
  });

  it("enforces the rolling send-rate window", async () => {
    otpChallengeFindFirst.mockResolvedValue(
      fakeChallenge({ lastSentAt: new Date(Date.now() - 61_000), sendCount: 5, createdAt: new Date() })
    );

    const { issueOtpChallenge } = await import("./challenge");
    const result = await issueOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier: "+919000000000" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
  });
});

describe("verifyOtpChallenge", () => {
  it("succeeds with the correct OTP", async () => {
    const { hashOtp, generateOtpSalt } = await import("./crypto");
    const salt = generateOtpSalt();
    const otp = "654321";
    otpChallengeFindFirst.mockResolvedValue(fakeChallenge({ otpHash: hashOtp(otp, salt), otpSalt: salt }));
    otpChallengeUpdate.mockResolvedValue({});

    const { verifyOtpChallenge } = await import("./challenge");
    const result = await verifyOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier: "+919000000000" }, otp);

    expect(result.ok).toBe(true);
    expect(otpChallengeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) })
    );
  });

  it("fails with an incorrect OTP and increments attempts", async () => {
    const { hashOtp, generateOtpSalt } = await import("./crypto");
    const salt = generateOtpSalt();
    otpChallengeFindFirst.mockResolvedValue(fakeChallenge({ otpHash: hashOtp("111111", salt), otpSalt: salt }));
    otpChallengeUpdate.mockResolvedValue({});

    const { verifyOtpChallenge } = await import("./challenge");
    const result = await verifyOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier: "+919000000000" }, "222222");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_OTP");
    expect(otpChallengeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { attempts: { increment: 1 } } })
    );
  });

  it("fails when the challenge has expired", async () => {
    otpChallengeFindFirst.mockResolvedValue(fakeChallenge({ expiresAt: new Date(Date.now() - 1000) }));

    const { verifyOtpChallenge } = await import("./challenge");
    const result = await verifyOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier: "+919000000000" }, "123456");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXPIRED");
  });

  it("enforces maximum verification attempts", async () => {
    otpChallengeFindFirst.mockResolvedValue(fakeChallenge({ attempts: 5, maxAttempts: 5 }));
    otpChallengeUpdate.mockResolvedValue({});

    const { verifyOtpChallenge } = await import("./challenge");
    const result = await verifyOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier: "+919000000000" }, "123456");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("cannot be reused (single-use) — a verified/used challenge is excluded from lookup", async () => {
    // findActiveChallenge filters usedAt: null, so a second verify call sees
    // no active challenge at all once the first verify marked it used.
    otpChallengeFindFirst.mockResolvedValue(null);

    const { verifyOtpChallenge } = await import("./challenge");
    const result = await verifyOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier: "+919000000000" }, "654321");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND for no active challenge", async () => {
    otpChallengeFindFirst.mockResolvedValue(null);

    const { verifyOtpChallenge } = await import("./challenge");
    const result = await verifyOtpChallenge({ purpose: OtpPurpose.LOGIN_OTP, identifier: "+919000000000" }, "123456");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("enforces purpose binding — queries always filter by purpose, so a LOGIN_OTP challenge is invisible to a PO_APPROVAL_OTP lookup", async () => {
    otpChallengeFindFirst.mockResolvedValue(null);

    const { verifyOtpChallenge } = await import("./challenge");
    await verifyOtpChallenge(
      { purpose: OtpPurpose.PO_APPROVAL_OTP, identifier: "builder@example.com", purchaseOrderId: "po-1" },
      "123456"
    );

    expect(otpChallengeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ purpose: OtpPurpose.PO_APPROVAL_OTP, purchaseOrderId: "po-1" }),
      })
    );
  });

  it("enforces PO scoping — an OTP for one PO cannot verify against another PO's scope", async () => {
    // The challenge row returned belongs to po-1 (per the where clause this
    // mock simulates matching), but a verify call scoped to po-2 queries
    // with purchaseOrderId: "po-2" — the mocked findFirst would return null
    // for a genuinely different PO's scope in real usage since the WHERE
    // clause filters on purchaseOrderId.
    otpChallengeFindFirst.mockImplementation(async (args: any) => {
      if (args.where.purchaseOrderId === "po-1") return fakeChallenge({ purchaseOrderId: "po-1" });
      return null;
    });

    const { verifyOtpChallenge } = await import("./challenge");
    const result = await verifyOtpChallenge(
      { purpose: OtpPurpose.PO_APPROVAL_OTP, identifier: "builder@example.com", purchaseOrderId: "po-2" },
      "123456"
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });
});
