// Provider abstraction for sending an OTP via SMS. Mirrors the existing
// WhatsAppSendAdapter pattern in apps/api/src/whatsapp/adapters/whatsapp-send.interface.ts
// — a narrow interface so a future real MSG91 (or any other SMS provider)
// implementation can be swapped in without any change to the OTP
// delivery-orchestration code that calls it.

export type SmsOtpSendResult =
  | { status: "SENT"; providerMessageId: string }
  | { status: "FAILED"; error: string }
  // Distinct from FAILED: the provider is deliberately disabled/unconfigured
  // (e.g. MSG91_OTP_ENABLED=false) rather than having attempted and failed a
  // real network call. Callers MUST treat this as "SMS unavailable" and MUST
  // NOT report it to the end user as a successful send.
  | { status: "NOT_CONFIGURED"; reason: string };

export interface SmsOtpProvider {
  /** Name reported in OtpChallenge.provider for observability (e.g. "msg91"). */
  readonly providerName: string;

  sendOtp(toPhoneE164: string, otp: string): Promise<SmsOtpSendResult>;
}
