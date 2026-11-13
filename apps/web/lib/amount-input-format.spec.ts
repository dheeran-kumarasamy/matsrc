// Advance Payment page — Advance Balance amount input improvements.
// Pure unit tests for lib/amount-input-format.ts: Indian-style (en-IN)
// comma grouping applied to the Add Advance amount input while typing, and
// the inverse strip/parse used before validation, API submission, and
// financial calculations. Source-based/pure-logic tests only — this repo
// has no jsdom/testing-library harness (see vitest.config.ts,
// environment: "node"), mirroring lib/gst-display.spec.ts-style pure tests.

import { describe, expect, it } from "vitest";
import {
  formatAmountIndian,
  getFormattedCursorIndex,
  parseAmountValue,
  stripAmountFormatting,
} from "./amount-input-format";

describe("formatAmountIndian", () => {
  it("returns an empty string for an empty/blank raw value (never converts to zero)", () => {
    expect(formatAmountIndian("")).toBe("");
  });

  it("formats thousands, lakhs and crores with Indian-style digit grouping", () => {
    expect(formatAmountIndian("1000")).toBe("1,000");
    expect(formatAmountIndian("10000")).toBe("10,000");
    expect(formatAmountIndian("100000")).toBe("1,00,000");
    expect(formatAmountIndian("1000000")).toBe("10,00,000");
    expect(formatAmountIndian("2500000")).toBe("25,00,000");
  });

  it("preserves an in-progress decimal part while typing", () => {
    expect(formatAmountIndian("100000.")).toBe("1,00,000.");
    expect(formatAmountIndian("100000.5")).toBe("1,00,000.5");
    expect(formatAmountIndian("100000.50")).toBe("1,00,000.50");
  });

  it("formats small single/double digit amounts without spurious commas", () => {
    expect(formatAmountIndian("5")).toBe("5");
    expect(formatAmountIndian("99")).toBe("99");
    expect(formatAmountIndian("999")).toBe("999");
  });
});

describe("stripAmountFormatting", () => {
  it("strips commas and whitespace from a pasted formatted value", () => {
    expect(stripAmountFormatting("1,00,000")).toBe("100000");
    expect(stripAmountFormatting("1, 00, 000")).toBe("100000");
    expect(stripAmountFormatting("  25,00,000  ")).toBe("2500000");
  });

  it("keeps only digits and a single decimal point, capped at 2 decimal places", () => {
    expect(stripAmountFormatting("1,00,000.5")).toBe("100000.5");
    expect(stripAmountFormatting("1,00,000.567")).toBe("100000.56");
    expect(stripAmountFormatting("₹1,00,000")).toBe("100000");
  });

  it("returns an empty string for empty input (deleting all digits leaves the field blank)", () => {
    expect(stripAmountFormatting("")).toBe("");
  });

  it("is idempotent on an already-clean raw value", () => {
    expect(stripAmountFormatting("100000")).toBe("100000");
  });
});

describe("parseAmountValue", () => {
  it("parses a comma-formatted display value into a clean finite number for validation/submission", () => {
    expect(parseAmountValue("1,00,000")).toBe(100000);
    expect(parseAmountValue("25,00,000")).toBe(2500000);
    expect(parseAmountValue("1,000.50")).toBe(1000.5);
  });

  it("parses an empty value to 0, which the existing `amountNum <= 0` validation still rejects", () => {
    // Number("") is 0 (not NaN) in JS — the existing submit() validation in
    // AddAdvanceForm already guards against this via `amountNum <= 0`, so
    // this asserts that guard condition continues to hold for a blank field.
    const parsed = parseAmountValue("");
    expect(Number.isFinite(parsed)).toBe(true);
    expect(parsed <= 0).toBe(true);
  });
});

describe("getFormattedCursorIndex", () => {
  it("keeps the caret immediately after the same digit when commas are inserted around it", () => {
    // Typing "100000" -> caret after all 6 digits -> formatted "1,00,000"
    // (8 chars) -> caret should land at the very end.
    expect(getFormattedCursorIndex(6, "1,00,000")).toBe(8);
  });

  it("positions the caret correctly when editing in the middle of the amount", () => {
    // Raw "150000" with caret after the 3rd digit ("150|000") formats to
    // "1,50,000"; the 3rd digit ('5') is at index 3, so caret should land
    // right after it, i.e. index 4.
    expect(getFormattedCursorIndex(3, "1,50,000")).toBe(4);
  });

  it("returns 0 when there are no digits before the cursor (e.g. empty field)", () => {
    expect(getFormattedCursorIndex(0, "")).toBe(0);
  });

  it("clamps to the end of the formatted string when the digit count exceeds its length", () => {
    expect(getFormattedCursorIndex(99, "1,00,000")).toBe("1,00,000".length);
  });
});
