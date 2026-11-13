// Shared OTP security constants for the C20 (Login) + C37 (PO Approval)
// OTP challenges. Deliberately mirrors the values already established and
// battle-tested in apps/web/lib/contact-verification/otp.ts — reusing the
// SAME numbers (not just the same shape) so there is one consistent OTP
// security posture across every OTP flow in this app, per the investigation
// recommendation ("If the existing project already has established
// security constants, reuse them where appropriate rather than introducing
// conflicting values").

/** OTP length — 6 digits, matching every existing OTP UI in this app. */
export const OTP_LENGTH = 6;

/** OTP validity window — 5 minutes per the C20/C37 implementation spec. */
export const OTP_TTL_MS = 5 * 60 * 1000;

/** Minimum time between an OTP send and the next allowed resend. */
export const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

/** Max failed verification attempts against a single OTP challenge before it is locked out. */
export const MAX_VERIFY_ATTEMPTS = 5;

/** Max OTP sends (initial + resends) allowed per rolling window, per scope. */
export const MAX_SENDS_PER_WINDOW = 5;
export const SEND_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
