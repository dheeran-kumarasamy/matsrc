import { describe, expect, it } from "vitest";
import { generateMerchantTxnNo } from "./merchant-txn";
import { generatePaymentReference } from "./payment-reference";

describe("generateMerchantTxnNo", () => {
  it("never exceeds 20 characters (ICICI merchantTxnNo length constraint)", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateMerchantTxnNo().length).toBeLessThanOrEqual(20);
    }
  });

  it("is alphanumeric only (no special characters)", () => {
    const txnNo = generateMerchantTxnNo();
    expect(txnNo).toMatch(/^[A-Z0-9]+$/);
  });

  it("starts with the UAT prefix so it is clearly distinguishable from any future production transaction number", () => {
    expect(generateMerchantTxnNo().startsWith("UAT")).toBe(true);
  });

  it("generates distinct values across many calls (low-collision)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generateMerchantTxnNo());
    }
    expect(seen.size).toBe(200);
  });
});

describe("generatePaymentReference", () => {
  it("is distinct from the merchantTxnNo format and clearly UAT-labelled", () => {
    const ref = generatePaymentReference();
    expect(ref).toMatch(/^PAY-ICICI-UAT-\d{8}-[A-F0-9]{8}$/);
  });

  it("generates distinct values across many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(generatePaymentReference());
    }
    expect(seen.size).toBe(100);
  });
});
