import type { SmsOtpProvider, SmsOtpSendResult } from "./sms-provider.interface";

// MSG91 SMS OTP provider — STUBBED / DISABLED per the C20/C37 implementation
// spec ("Do not implement real MSG91 SMS delivery in this task"). This class
// never makes a real MSG91 API call, never requires MSG91 credentials, and
// never reports a fake successful SMS delivery — it always resolves
// `{ status: "NOT_CONFIGURED" }`, which the OTP delivery service (see
// ../delivery.ts) treats as "SMS unavailable" and falls back to email.
//
// ACTIVATION PATH (future, not implemented here): flipping
// `MSG91_OTP_ENABLED=true` plus providing `MSG91_AUTH_KEY` /
// `MSG91_SENDER_ID` / `MSG91_OTP_TEMPLATE_ID` / `MSG91_DLT_ENTITY_ID` would
// let a real implementation call the MSG91 API inside `sendOtp()` below —
// no other OTP service/C20/C37 code needs to change, because callers only
// depend on the `SmsOtpProvider` interface, never on MSG91 specifics. The
// real MSG91 API contract has not been verified as part of this task, so no
// real HTTP call is implemented — only the configuration surface is
// prepared (see .env.example).
export class Msg91SmsProvider implements SmsOtpProvider {
  readonly providerName = "msg91";

  async sendOtp(_toPhoneE164: string, _otp: string): Promise<SmsOtpSendResult> {
    const enabled = process.env.MSG91_OTP_ENABLED === "true";

    if (!enabled) {
      return {
        status: "NOT_CONFIGURED",
        reason: "MSG91 SMS OTP delivery is stubbed/disabled (MSG91_OTP_ENABLED is not \"true\").",
      };
    }

    // Even if MSG91_OTP_ENABLED were flipped on, this task explicitly does
    // NOT implement a real MSG91 API call (unverified API contract) — so a
    // real enable attempt still safely reports NOT_CONFIGURED rather than
    // either throwing or pretending to succeed.
    return {
      status: "NOT_CONFIGURED",
      reason: "MSG91 SMS OTP delivery is not yet implemented — only the provider interface and configuration surface are prepared.",
    };
  }
}
