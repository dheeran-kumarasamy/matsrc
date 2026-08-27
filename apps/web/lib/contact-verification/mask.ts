// Display-only masking helpers for the OTP verification UI/modal (task spec
// §2.5 / §3.5 — "partially masked where appropriate"). Never used for
// anything security-relevant; purely cosmetic.

/** Masks an email address, e.g. "john.doe@example.com" -> "jo******@example.com". */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "***";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  const masked = "*".repeat(Math.max(local.length - visible.length, 3));
  return `${visible}${masked}@${domain}`;
}

/** Masks a phone number, e.g. "+919876543210" -> "+91******3210". */
export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  const last4 = digits.slice(-4);
  const middleLength = Math.max(digits.length - 4, 3);
  return `+${"*".repeat(middleLength)}${last4}`;
}
