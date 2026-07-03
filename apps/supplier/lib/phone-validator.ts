/**
 * Simple client-side phone number validation utilities
 * Uses basic regex patterns; full validation happens on backend
 */

// E.164 format pattern
const E164_PATTERN = /^\+\d{1,3}\d{4,14}$/;

// Indian phone pattern (common case)
const INDIAN_PHONE_PATTERN = /^(\+91[-.\s]?)?[6-9]\d{9}$/;

/**
 * Quick validation that a phone looks reasonable
 * Returns true if it might be valid; backend does authoritative check
 */
export function validatePhoneFormat(phone: string | null | undefined): boolean {
  if (!phone || typeof phone !== 'string') {
    return false;
  }

  const trimmed = phone.trim();
  if (!trimmed) {
    return false;
  }

  // Check E.164 format
  if (trimmed.startsWith('+')) {
    return E164_PATTERN.test(trimmed);
  }

  // Check Indian local format
  return INDIAN_PHONE_PATTERN.test(trimmed);
}

/**
 * Get validation error message for display
 */
export function getPhoneErrorMessage(phone: string | null | undefined): string | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  const trimmed = phone.trim();
  if (!trimmed) {
    return null;
  }

  if (!validatePhoneFormat(trimmed)) {
    return "Please enter a valid phone number (e.g. +91 9876543210 or 9876543210)";
  }

  return null;
}
