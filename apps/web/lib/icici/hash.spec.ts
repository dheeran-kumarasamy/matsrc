import { describe, expect, it } from "vitest";
import { generateICICIHash, verifyICICIHash, buildIciciSignableString } from "./hash";

// NOTE: ICICI's own official sample request/response + expected hash values
// were not supplied alongside this task (see hash.ts's doc comment) — per
// task section 18 these tests exercise the documented ALGORITHM behaviour
// (field exclusion, alphabetical sort, value-only concatenation, HMAC-SHA256
// hex output) deterministically, rather than asserting against an invented
// "official" sample. Before go-live with real ICICI UAT credentials, replace
// these with ICICI's own published sample values once the signed spec
// document is available.
describe("buildIciciSignableString", () => {
  it("excludes secureHash from the signable string", () => {
    const signable = buildIciciSignableString({ b: "2", secureHash: "should-not-appear", a: "1" });
    expect(signable).not.toContain("should-not-appear");
  });

  it("sorts fields alphabetically before concatenating values", () => {
    const signable = buildIciciSignableString({ zeta: "Z", alpha: "A", mid: "M" });
    expect(signable).toBe("AMZ");
  });

  it("coerces null/undefined values to empty string", () => {
    const signable = buildIciciSignableString({ a: "1", b: null, c: undefined, d: "4" });
    expect(signable).toBe("1" + "" + "" + "4");
  });
});

describe("generateICICIHash", () => {
  it("is deterministic for the same payload and secret", () => {
    const payload = { merchantId: "M1", merchantTxnNo: "UAT123", amount: "100.00" };
    const h1 = generateICICIHash(payload, "secret-key");
    const h2 = generateICICIHash(payload, "secret-key");
    expect(h1).toBe(h2);
  });

  it("produces a 64-character lowercase hex digest (SHA-256)", () => {
    const hash = generateICICIHash({ a: "1" }, "secret");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any field value changes (tamper detection)", () => {
    const base = generateICICIHash({ amount: "100.00", merchantTxnNo: "UAT1" }, "secret");
    const tampered = generateICICIHash({ amount: "999.00", merchantTxnNo: "UAT1" }, "secret");
    expect(base).not.toBe(tampered);
  });

  it("changes when the secret changes", () => {
    const payload = { amount: "100.00" };
    expect(generateICICIHash(payload, "secret-a")).not.toBe(generateICICIHash(payload, "secret-b"));
  });

  it("ignores the secureHash field itself when present in the payload", () => {
    const withoutHash = generateICICIHash({ a: "1", b: "2" }, "secret");
    const withHash = generateICICIHash({ a: "1", b: "2", secureHash: "anything" }, "secret");
    expect(withoutHash).toBe(withHash);
  });
});

describe("verifyICICIHash", () => {
  it("verifies a correctly-signed payload", () => {
    const payload = { merchantTxnNo: "UAT1", amount: "100.00" };
    const secureHash = generateICICIHash(payload, "secret");
    expect(verifyICICIHash({ ...payload, secureHash }, "secret")).toBe(true);
  });

  it("rejects a payload with a modified field after signing (tampered)", () => {
    const payload = { merchantTxnNo: "UAT1", amount: "100.00" };
    const secureHash = generateICICIHash(payload, "secret");
    expect(verifyICICIHash({ merchantTxnNo: "UAT1", amount: "999.00", secureHash }, "secret")).toBe(false);
  });

  it("rejects when verified with the wrong secret", () => {
    const payload = { merchantTxnNo: "UAT1", amount: "100.00" };
    const secureHash = generateICICIHash(payload, "secret-a");
    expect(verifyICICIHash({ ...payload, secureHash }, "secret-b")).toBe(false);
  });

  it("rejects a payload with a missing secureHash", () => {
    expect(verifyICICIHash({ merchantTxnNo: "UAT1" } as any, "secret")).toBe(false);
  });
});
