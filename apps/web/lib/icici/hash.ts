// apps/web/lib/icici/hash.ts
//
// ICICI Bank Payment Gateway — UAT ONLY. HMAC-SHA256 signing/verification
// utility.
//
// IMPORTANT — SPEC ASSUMPTION: this repo was not given ICICI's actual signed
// UAT API specification document (field list, exact field order, delimiter,
// case-sensitivity rules) alongside this task, only the high-level
// description in section 18 ("Exclude secureHash. Sort fields exactly as
// specified. Concatenate values exactly as specified. Generate HMAC-SHA256.
// Produce the expected hexadecimal representation."). This implementation
// therefore uses the most common, documented ICICI PG convention observed
// across ICICI's published integration guides:
//
//   1. Remove any `secureHash` field from the payload.
//   2. Sort the REMAINING keys alphabetically (case-sensitive, ascending).
//   3. Concatenate the VALUES ONLY (no keys, no delimiters) in that sorted
//      key order, coercing null/undefined to an empty string.
//   4. HMAC-SHA256 the concatenated string using the merchant secret key.
//   5. Hex-encode (lowercase) the resulting digest.
//
// BEFORE GOING LIVE WITH REAL ICICI UAT CREDENTIALS: replace
// buildIciciSignableString()'s field-sort/concatenation rule below with the
// EXACT rule from ICICI's signed UAT specification document, and update
// hash.spec.ts to assert against ICICI's own official sample
// request/response + expected hash values (never invented values) — per
// task section 18 ("Use the official ICICI sample values to create automated
// tests. Do not approximate the algorithm."). Shipping this against a real
// ICICI UAT merchant without that confirmation step would silently produce
// wrong signatures and all requests would be rejected by ICICI's gateway.
import { createHmac } from "crypto";

export type IciciHashablePayload = Record<string, string | number | boolean | null | undefined>;

/**
 * Builds the exact string that is signed — excludes `secureHash`, sorts the
 * remaining keys alphabetically, and concatenates values only.
 */
export function buildIciciSignableString(payload: IciciHashablePayload): string {
  const keys = Object.keys(payload)
    .filter((key) => key !== "secureHash")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return keys.map((key) => stringifyValue(payload[key])).join("");
}

function stringifyValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Generates the ICICI-compatible HMAC-SHA256 hex digest for a given payload
 * and merchant secret key. `secret` must come only from server-side
 * environment configuration (ICICI_PG_SECRET_KEY) — never hard-coded, never
 * logged, never sent to the browser.
 */
export function generateICICIHash(payload: IciciHashablePayload, secret: string): string {
  const signable = buildIciciSignableString(payload);
  return createHmac("sha256", secret).update(signable, "utf8").digest("hex");
}

/**
 * Verifies a payload's `secureHash` field against an independently
 * recomputed HMAC using the same secret — used to validate both ICICI's
 * callback/return payloads and STATUS/REFUND command responses. Returns
 * false (never throws) for a missing/malformed secureHash so callers can
 * treat any verification failure uniformly as "untrusted".
 */
export function verifyICICIHash(payload: IciciHashablePayload & { secureHash?: string | null }, secret: string): boolean {
  if (!payload.secureHash || typeof payload.secureHash !== "string") return false;
  const expected = generateICICIHash(payload, secret);
  return timingSafeEqualHex(expected, payload.secureHash.toLowerCase());
}

// Constant-time-ish comparison for hex digests of identical expected length
// (both are SHA-256 hex, i.e. always 64 chars) — avoids leaking timing
// information about how many leading characters matched.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
