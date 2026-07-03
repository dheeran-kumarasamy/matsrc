import { parsePhoneNumber, isValidPhoneNumber, CountryCode } from 'libphonenumber-js';

/**
 * Normalize phone number to E.164 format
 * @param phone - Phone number in any format (e.g. +91 98765 43210, 9876543210, 98765-43210)
 * @param defaultCountry - Default country code if number is local (e.g. 'IN')
 * @returns Normalized E.164 format or null if invalid
 */
export function normalizePhoneNumber(phone: string | null | undefined, defaultCountry: CountryCode = 'IN'): string | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  const trimmed = phone.trim();
  if (!trimmed) {
    return null;
  }

  try {
    // If no + prefix, assume it's a local number and prepend country code
    const phoneToCheck = trimmed.startsWith('+') ? trimmed : `+${defaultCountry === 'IN' ? '91' : defaultCountry}${trimmed}`;
    
    const parsed = parsePhoneNumber(phoneToCheck, defaultCountry);
    if (parsed && parsed.isValid()) {
      return parsed.format('E.164');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate phone number in E.164 format
 * @param phone - Phone number in E.164 format
 * @returns true if valid, false otherwise
 */
export function isValidPhone(phone: string | null | undefined): boolean {
  if (!phone || typeof phone !== 'string') {
    return false;
  }

  try {
    const parsed = parsePhoneNumber(phone);
    return parsed ? parsed.isValid() : false;
  } catch {
    return false;
  }
}

/**
 * Get country code from phone number
 * @param phone - Phone number in E.164 format
 * @returns Country code (e.g. 'IN', 'US') or null if invalid
 */
export function getCountryFromPhone(phone: string | null | undefined): CountryCode | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  try {
    const parsed = parsePhoneNumber(phone);
    return parsed?.country || null;
  } catch {
    return null;
  }
}

/**
 * Check if phone number appears to be a WhatsApp-enabled region
 * (For now, assume most modern numbers work; can be extended)
 */
export function canUseWhatsApp(phone: string | null | undefined): boolean {
  if (!phone) {
    return false;
  }
  
  // First validate the phone number
  if (!isValidPhone(phone)) {
    return false;
  }

  // In the future, this can check against a list of unsupported countries
  return true;
}

/**
 * Mask phone number for logging/display (e.g. +91 9876 **** 3210)
 */
export function maskPhoneNumber(phone: string | null | undefined): string {
  if (!phone || typeof phone !== 'string') {
    return '***';
  }

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) {
    return '***';
  }

  const start = digits.substring(0, 4);
  const end = digits.substring(digits.length - 4);
  return `+${start}...${end}`;
}
