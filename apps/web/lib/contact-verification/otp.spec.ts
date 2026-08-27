import { describe, it, expect } from "vitest";
import {
  generateOtp,
  generateOtpSalt,
  hashOtp,
  verifyOtpHash,
  isExpired,
  computeExpiry,
  OTP_LENGTH,
  OTP_TTL_MS,
} from "./otp";

describe("generateOtp", () => {
  it("generates a 6-digit numeric string, zero-padded", () => {
    for (let i = 0; i < 50; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
      expect(otp.length).toBe(OTP_LENGTH);
    }
  });

  it("does not always produce the same value (uses a CSPRNG, not a fixed value)", () => {
    const values = new Set(Array.from({ length: 20 }, () => generateOtp()));
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("hashOtp / verifyOtpHash", () => {
  it("never stores the plaintext OTP — the hash differs from the OTP itself", () => {
    const otp = "123456";
    const salt = generateOtpSalt();
    const hash = hashOtp(otp, salt);
    expect(hash).not.toBe(otp);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("verifies a correct OTP against its own hash+salt", () => {
    const otp = "654321";
    const salt = generateOtpSalt();
    const hash = hashOtp(otp, salt);
    expect(verifyOtpHash(otp, hash, salt)).toBe(true);
  });

  it("rejects an incorrect OTP", () => {
    const salt = generateOtpSalt();
    const hash = hashOtp("111111", salt);
    expect(verifyOtpHash("222222", hash, salt)).toBe(false);
  });

  it("rejects malformed candidate OTPs (non-6-digit)", () => {
    const salt = generateOtpSalt();
    const hash = hashOtp("111111", salt);
    expect(verifyOtpHash("11111", hash, salt)).toBe(false);
    expect(verifyOtpHash("abcdef", hash, salt)).toBe(false);
  });

  it("produces different hashes for the same OTP with different salts", () => {
    const otp = "123456";
    const hash1 = hashOtp(otp, generateOtpSalt());
    const hash2 = hashOtp(otp, generateOtpSalt());
    expect(hash1).not.toBe(hash2);
  });
});

describe("expiry helpers", () => {
  it("computeExpiry adds the OTP_TTL_MS window", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiry = computeExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(OTP_TTL_MS);
  });

  it("isExpired is false before expiry and true at/after it", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiry = computeExpiry(now);
    expect(isExpired(expiry, new Date(expiry.getTime() - 1))).toBe(false);
    expect(isExpired(expiry, expiry)).toBe(true);
    expect(isExpired(expiry, new Date(expiry.getTime() + 1))).toBe(true);
  });
});
