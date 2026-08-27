import { parsePhoneNumber } from "libphonenumber-js";

// Format validation for the /profile email + phone change flow. Mirrors the
// existing conventions already used elsewhere in the repo:
//  - Email: standard RFC-5322-ish pragmatic regex (same shape the browser's
//    own `type="email"` input already enforces client-side; server-side
//    re-validation is required since this is a trust boundary).
//  - Phone: libphonenumber-js, the same library apps/api/src/common/validators
//    and apps/supplier/lib/supplier-data.ts already use for phone parsing —
//    reused here rather than introducing a second phone-validation approach.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmailFormat(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_PATTERN.test(trimmed);
}

/**
 * Validates and normalizes a phone number to E.164, defaulting to India ('IN')
 * when no explicit country code is present — same default-country convention
 * as apps/api/src/common/validators/phone.validator.ts's normalizePhoneNumber.
 * Returns null if the number cannot be parsed as valid.
 */
export function normalizePhone(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  try {
    const candidate = trimmed.startsWith("+") ? trimmed : `+91${trimmed.replace(/\D/g, "")}`;
    const parsed = parsePhoneNumber(candidate, "IN");
    if (parsed && parsed.isValid()) {
      return parsed.format("E.164");
    }
    return null;
  } catch {
    return null;
  }
}
