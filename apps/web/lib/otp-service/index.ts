// Public surface of the shared OTP service used by both C20 (Login OTP) and
// C37 (PO Approval OTP). Route handlers should only import from this
// barrel, not reach into individual files, so the internal module layout
// can change without touching call sites.

export { issueOtpChallenge, verifyOtpChallenge, recordDeliveryAttempt } from "./challenge";
export type { ChallengeScope, IssueResult, VerifyResult } from "./challenge";
export { deliverOtp, deliverOtpViaWhatsApp } from "./delivery";
export type { DeliveryTarget, DeliveryOutcome, WhatsAppDeliveryOutcome } from "./delivery";
export { checkOtpSendRateLimit, checkOtpVerifyRateLimit } from "./rate-limit";
export * from "./constants";
