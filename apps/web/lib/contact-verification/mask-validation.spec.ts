import { describe, it, expect } from "vitest";
import { maskEmail, maskPhone } from "./mask";
import { isValidEmailFormat, normalizeEmail, normalizePhone } from "./validation";

describe("maskEmail", () => {
  it("masks the local part but keeps the domain visible", () => {
    const masked = maskEmail("john.doe@example.com");
    expect(masked).toMatch(/^jo\*+@example\.com$/);
    expect(masked).not.toContain("john.doe");
  });

  it("handles very short local parts without throwing", () => {
    expect(maskEmail("a@b.com")).toMatch(/@b\.com$/);
  });
});

describe("maskPhone", () => {
  it("keeps only the last 4 digits visible", () => {
    const masked = maskPhone("+919876543210");
    expect(masked.endsWith("3210")).toBe(true);
    expect(masked).not.toContain("98765432");
  });
});

describe("isValidEmailFormat / normalizeEmail", () => {
  it("accepts well-formed addresses", () => {
    expect(isValidEmailFormat("user@example.com")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmailFormat("not-an-email")).toBe(false);
    expect(isValidEmailFormat("missing@domain")).toBe(false);
    expect(isValidEmailFormat("")).toBe(false);
  });

  it("normalizes case and trims whitespace", () => {
    expect(normalizeEmail(" User@Example.COM ")).toBe("user@example.com");
  });
});

describe("normalizePhone", () => {
  it("normalizes a bare Indian number to E.164 with default country", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
  });

  it("accepts an already-E.164 number with explicit country code", () => {
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
  });

  it("returns null for an invalid number", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});
