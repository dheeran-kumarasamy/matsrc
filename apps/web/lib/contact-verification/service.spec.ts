// Covers the OTP-based /profile email + phone change flow end-to-end at the
// service layer, with Prisma and the email/SMS senders mocked (same pattern
// as lib/sourcing/session-authorization.spec.ts — no real database or
// network calls). Exercises every scenario called out in the task spec's
// "Testing" section.

import { beforeEach, describe, expect, it, vi } from "vitest";

const userFindUnique = vi.fn();
const userFindFirst = vi.fn();
const userUpdate = vi.fn();
const pendingFindUnique = vi.fn();
const pendingUpsert = vi.fn();
const pendingUpdate = vi.fn();
const pendingDelete = vi.fn();
const pendingDeleteMany = vi.fn();
const transaction = vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      findFirst: (...args: unknown[]) => userFindFirst(...args),
      update: (...args: unknown[]) => userUpdate(...args),
    },
    pendingContactVerification: {
      findUnique: (...args: unknown[]) => pendingFindUnique(...args),
      upsert: (...args: unknown[]) => pendingUpsert(...args),
      update: (...args: unknown[]) => pendingUpdate(...args),
      delete: (...args: unknown[]) => pendingDelete(...args),
      deleteMany: (...args: unknown[]) => pendingDeleteMany(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...(args as [Promise<unknown>[]])),
  },
}));

const sendOtpEmail = vi.fn(async (_to: string, _otp: string) => ({ ok: true as const }));
const sendOtpSms = vi.fn(async (_to: string, _otp: string) => ({ ok: true as const }));

vi.mock("./email-sender", () => ({ sendOtpEmail: (to: string, otp: string) => sendOtpEmail(to, otp) }));
vi.mock("./sms-sender", () => ({ sendOtpSms: (to: string, otp: string) => sendOtpSms(to, otp) }));

const USER_ID = "user-1";

function fakeUser(overrides: Partial<{ email: string | null; phone: string | null }> = {}) {
  return { id: USER_ID, email: "old@example.com", phone: "+919000000000", ...overrides };
}

function fakePendingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "pending-1",
    userId: USER_ID,
    channel: "EMAIL",
    pendingValue: "new@example.com",
    otpHash: "",
    otpSalt: "",
    expiresAt: new Date(Date.now() + 10 * 60_000),
    attempts: 0,
    lastSentAt: new Date(Date.now() - 61_000),
    sendCount: 1,
    windowStartedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("initiateContactChange", () => {
  it("rejects an invalid email format without touching the database", async () => {
    const { initiateContactChange } = await import("./service");
    const result = await initiateContactChange(USER_ID, "EMAIL", "not-an-email");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_FORMAT");
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalid phone number", async () => {
    const { initiateContactChange } = await import("./service");
    const result = await initiateContactChange(USER_ID, "PHONE", "123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_FORMAT");
  });

  it("rejects re-submitting the already-verified current value", async () => {
    userFindUnique.mockResolvedValue(fakeUser({ email: "same@example.com" }));
    const { initiateContactChange } = await import("./service");
    const result = await initiateContactChange(USER_ID, "EMAIL", "same@example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNCHANGED");
  });

  it("handles a duplicate email/phone conflict with a generic message and never queries who owns it beyond existence", async () => {
    userFindUnique.mockResolvedValue(fakeUser());
    userFindFirst.mockResolvedValue({ id: "other-user" });
    const { initiateContactChange } = await import("./service");
    const result = await initiateContactChange(USER_ID, "EMAIL", "taken@example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFLICT");
      expect(result.message).not.toMatch(/other-user/);
    }
  });

  it("sends an OTP and creates a pending row for a fresh valid change", async () => {
    userFindUnique.mockResolvedValue(fakeUser());
    userFindFirst.mockResolvedValue(null);
    pendingFindUnique.mockResolvedValue(null);
    pendingUpsert.mockResolvedValue(fakePendingRow());
    const { initiateContactChange } = await import("./service");

    const result = await initiateContactChange(USER_ID, "EMAIL", "new@example.com");

    expect(result.ok).toBe(true);
    expect(sendOtpEmail).toHaveBeenCalledTimes(1);
    expect(sendOtpEmail).toHaveBeenCalledWith("new@example.com", expect.stringMatching(/^\d{6}$/));
    expect(pendingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_channel: { userId: USER_ID, channel: "EMAIL" } } })
    );
    if (result.ok) {
      expect(result.maskedTarget).not.toContain("new@example.com");
    }
  });

  it("sends an SMS (not email) for the PHONE channel", async () => {
    userFindUnique.mockResolvedValue(fakeUser());
    userFindFirst.mockResolvedValue(null);
    pendingFindUnique.mockResolvedValue(null);
    pendingUpsert.mockResolvedValue(fakePendingRow({ channel: "PHONE" }));
    const { initiateContactChange } = await import("./service");

    const result = await initiateContactChange(USER_ID, "PHONE", "9876543210");

    expect(result.ok).toBe(true);
    expect(sendOtpSms).toHaveBeenCalledTimes(1);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("enforces the 60s resend cooldown", async () => {
    userFindUnique.mockResolvedValue(fakeUser());
    userFindFirst.mockResolvedValue(null);
    pendingFindUnique.mockResolvedValue(fakePendingRow({ lastSentAt: new Date() }));
    const { initiateContactChange } = await import("./service");

    const result = await initiateContactChange(USER_ID, "EMAIL", "new@example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("COOLDOWN");
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("rate-limits after too many sends within the send window", async () => {
    userFindUnique.mockResolvedValue(fakeUser());
    userFindFirst.mockResolvedValue(null);
    pendingFindUnique.mockResolvedValue(
      fakePendingRow({
        lastSentAt: new Date(Date.now() - 61_000),
        sendCount: 5,
        windowStartedAt: new Date(Date.now() - 1000),
      })
    );
    const { initiateContactChange } = await import("./service");

    const result = await initiateContactChange(USER_ID, "EMAIL", "new@example.com");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
  });

  it("resending invalidates the previous OTP (upsert overwrites the single row per channel)", async () => {
    userFindUnique.mockResolvedValue(fakeUser());
    userFindFirst.mockResolvedValue(null);
    pendingFindUnique.mockResolvedValue(
      fakePendingRow({ lastSentAt: new Date(Date.now() - 61_000), sendCount: 1, windowStartedAt: new Date() })
    );
    pendingUpsert.mockResolvedValue(fakePendingRow());
    const { initiateContactChange } = await import("./service");

    await initiateContactChange(USER_ID, "EMAIL", "new@example.com");

    expect(pendingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ attempts: 0 }),
      })
    );
  });
});

describe("verifyContactChange", () => {
  it("returns NOT_FOUND when there is no pending row for this user+channel", async () => {
    pendingFindUnique.mockResolvedValue(null);
    const { verifyContactChange } = await import("./service");
    const result = await verifyContactChange(USER_ID, "EMAIL", "123456");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("returns EXPIRED and deletes the row for an expired OTP", async () => {
    pendingFindUnique.mockResolvedValue(fakePendingRow({ expiresAt: new Date(Date.now() - 1000) }));
    pendingDelete.mockResolvedValue({});
    const { verifyContactChange } = await import("./service");
    const result = await verifyContactChange(USER_ID, "EMAIL", "123456");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXPIRED");
    expect(pendingDelete).toHaveBeenCalledWith({ where: { id: "pending-1" } });
  });

  it("verifies a correct OTP, commits the new value, and deletes the pending row (single-use)", async () => {
    const { hashOtp, generateOtpSalt } = await import("./otp");
    const salt = generateOtpSalt();
    const otp = "654321";
    pendingFindUnique.mockResolvedValue(fakePendingRow({ otpHash: hashOtp(otp, salt), otpSalt: salt }));
    userFindFirst.mockResolvedValue(null);
    userUpdate.mockResolvedValue({});
    pendingDelete.mockResolvedValue({});

    const { verifyContactChange } = await import("./service");
    const result = await verifyContactChange(USER_ID, "EMAIL", otp);

    expect(result.ok).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({ email: "new@example.com", emailVerifiedAt: expect.any(Date) }),
      })
    );
    expect(pendingDelete).toHaveBeenCalledWith({ where: { id: "pending-1" } });
  });

  it("rejects an incorrect OTP and increments the attempt counter without touching User", async () => {
    const { hashOtp, generateOtpSalt } = await import("./otp");
    const salt = generateOtpSalt();
    pendingFindUnique.mockResolvedValue(fakePendingRow({ otpHash: hashOtp("111111", salt), otpSalt: salt }));

    const { verifyContactChange } = await import("./service");
    const result = await verifyContactChange(USER_ID, "EMAIL", "999999");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_OTP");
    expect(pendingUpdate).toHaveBeenCalledWith({
      where: { id: "pending-1" },
      data: { attempts: { increment: 1 } },
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("rejects reuse of an already-verified/deleted OTP (single-use)", async () => {
    // Once verified, the row no longer exists — a second verify attempt with
    // the same code must be treated exactly like NOT_FOUND.
    pendingFindUnique.mockResolvedValue(null);
    const { verifyContactChange } = await import("./service");
    const result = await verifyContactChange(USER_ID, "EMAIL", "654321");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("locks out verification after too many failed attempts and deletes the row", async () => {
    const { hashOtp, generateOtpSalt } = await import("./otp");
    const salt = generateOtpSalt();
    pendingFindUnique.mockResolvedValue(
      fakePendingRow({ otpHash: hashOtp("111111", salt), otpSalt: salt, attempts: 5 })
    );
    pendingDelete.mockResolvedValue({});

    const { verifyContactChange } = await import("./service");
    const result = await verifyContactChange(USER_ID, "EMAIL", "111111");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TOO_MANY_ATTEMPTS");
    expect(pendingDelete).toHaveBeenCalledWith({ where: { id: "pending-1" } });
  });

  it("re-checks for a conflict at verification time and refuses to commit if the value was claimed meanwhile", async () => {
    const { hashOtp, generateOtpSalt } = await import("./otp");
    const salt = generateOtpSalt();
    const otp = "654321";
    pendingFindUnique.mockResolvedValue(fakePendingRow({ otpHash: hashOtp(otp, salt), otpSalt: salt }));
    userFindFirst.mockResolvedValue({ id: "other-user" });
    pendingDelete.mockResolvedValue({});

    const { verifyContactChange } = await import("./service");
    const result = await verifyContactChange(USER_ID, "EMAIL", otp);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("cancelContactChange", () => {
  it("deletes the pending row and leaves the existing verified value untouched", async () => {
    const { cancelContactChange } = await import("./service");
    await cancelContactChange(USER_ID, "PHONE");
    expect(pendingDeleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID, channel: "PHONE" } });
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("independent email + phone verification", () => {
  it("changing both channels tracks them as separate pending rows keyed by channel", async () => {
    userFindUnique.mockResolvedValue(fakeUser());
    userFindFirst.mockResolvedValue(null);
    pendingFindUnique.mockResolvedValue(null);
    pendingUpsert.mockResolvedValue(fakePendingRow());
    const { initiateContactChange } = await import("./service");

    await initiateContactChange(USER_ID, "EMAIL", "new@example.com");
    await initiateContactChange(USER_ID, "PHONE", "9876543210");

    expect(pendingUpsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { userId_channel: { userId: USER_ID, channel: "EMAIL" } } })
    );
    expect(pendingUpsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { userId_channel: { userId: USER_ID, channel: "PHONE" } } })
    );
  });
});
