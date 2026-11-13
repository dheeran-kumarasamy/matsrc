// Advance Payment page — Advance Balance amount input improvements.
//
// Pure, framework-free formatting/parsing helpers so the Add Advance amount
// input can display Indian-style (en-IN) digit grouping WHILE the user
// types, without ever sending a comma-formatted string to the API or into
// any numeric/validation/calculation path. Mirrors the existing convention
// of small pure-logic modules under lib/ (see lib/gst-display.ts,
// lib/order-timeline.ts) so this is directly unit-testable without a
// DOM/rendering environment (this repo has no jsdom/testing-library setup —
// see vitest.config.ts, environment: "node").
//
// Source of truth for the amount is always the RAW, unformatted numeric
// string (e.g. "100000" or "100000.5") — formatAmountIndian() is a pure
// display transform applied only at render time; stripAmountFormatting()
// is the inverse, applied to whatever the user just typed/pasted/edited.

/**
 * Strips commas/whitespace and any non-numeric characters from a raw input
 * string, keeping at most one decimal point and at most 2 digits after it
 * (matching the existing `step="0.01"` precision already used by the
 * Advance Balance amount input — no new decimal/rounding behaviour is
 * introduced here). Safe to call on an already-clean string, a
 * comma-formatted display string, or a pasted value containing commas
 * and/or whitespace.
 */
export function stripAmountFormatting(value: string): string {
  if (!value) return "";
  // Drop commas and whitespace (covers pasted "1,00,000" and "1, 00, 000").
  let cleaned = value.replace(/,/g, "").replace(/\s/g, "");
  // Keep only digits and dots.
  cleaned = cleaned.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;

  const intPart = cleaned.slice(0, firstDot);
  const decPart = cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
  return `${intPart}.${decPart}`;
}

/**
 * Formats a RAW numeric string (as produced by stripAmountFormatting) using
 * Indian-style digit grouping (1,000 / 10,000 / 1,00,000 / 10,00,000 /
 * 25,00,000), preserving an in-progress decimal part (e.g. "100000." or
 * "100000.5") so the user can keep typing after the decimal point without
 * it being stripped. Returns "" for an empty/blank raw value — an empty
 * input is NEVER converted to "0".
 */
export function formatAmountIndian(raw: string): string {
  if (!raw) return "";
  const [intPartRaw, decPart] = raw.split(".");
  const intPart = intPartRaw === "" ? "0" : intPartRaw;
  const intNum = Number(intPart);
  const formattedInt = Number.isFinite(intNum) && intPart !== ""
    ? intNum.toLocaleString("en-IN", { maximumFractionDigits: 0 })
    : intPartRaw;

  if (decPart === undefined) {
    // No decimal point typed at all.
    return intPartRaw === "" ? "" : formattedInt;
  }
  // A decimal point was typed (decPart may be "" right after typing ".").
  return `${intPartRaw === "" ? "0" : formattedInt}.${decPart}`;
}

/**
 * Parses a (possibly comma-formatted) display string into a clean number,
 * suitable for validation, API submission, and financial calculations.
 * Returns NaN for an empty/invalid value — callers already treat
 * `!Number.isFinite(amount)` as invalid, so this introduces no new
 * validation behaviour.
 */
export function parseAmountValue(value: string): number {
  return Number(stripAmountFormatting(value));
}

/**
 * Given how many numeric characters (digits/decimal point) preceded the
 * caret before reformatting, returns the caret index into the newly
 * formatted (comma-grouped) string that keeps the caret immediately after
 * the same numeric character — i.e. typing/deleting/inserting in the
 * middle of the amount doesn't make the caret jump to an unexpected
 * position once commas are inserted/removed around it.
 */
export function getFormattedCursorIndex(digitsBeforeCursor: number, formatted: string): number {
  if (digitsBeforeCursor <= 0) return 0;
  let count = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[0-9.]/.test(formatted[i])) {
      count++;
      if (count === digitsBeforeCursor) return i + 1;
    }
  }
  return formatted.length;
}
