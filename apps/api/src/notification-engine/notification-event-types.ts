/**
 * Central Notification Event Type registry (Phase 2 of the Buildohub
 * Notification Engine + WhatsApp Alerting System spec).
 *
 * This is the single source of truth for every event type the notification
 * engine is capable of routing through NotificationPolicyService ->
 * Template Registry (NotificationEventPolicy) -> Channel Dispatcher.
 *
 * IMPORTANT: this registry defines the *foundation* — not every event type
 * below has a production integration wired up yet (see Phase 13 in the
 * spec / the deliverables report for exactly which are wired). Adding a new
 * business-event integration should never require inventing a new event
 * type outside this list; extend this list first, then wire the call site.
 */

export const CUSTOMER_EVENT_TYPES = [
  "RFQ_SUBMITTED",
  "QUOTE_RECEIVED",
  "QUOTE_COMPARISON_READY",
  "QUOTE_EXPIRY_REMINDER",
  "RFQ_LOW_RESPONSE",
  "PAYMENT_REQUIRED",
  "PAYMENT_SUCCESS",
  "PAYMENT_FAILED",
  "ORDER_CREATED",
  "ORDER_STATUS_CHANGED",
  "DELIVERY_EXCEPTION",
  "DELIVERY_DISPATCHED",
  "DELIVERY_OUT_FOR_DELIVERY",
  "DELIVERY_COMPLETED",
  "ACTION_REQUIRED",
] as const;

export const SUPPLIER_EVENT_TYPES = [
  "SUPPLIER_RFQ_RECEIVED",
  "SUPPLIER_RFQ_REMINDER",
  "SUPPLIER_RFQ_DEADLINE",
  "SUPPLIER_QUOTE_ACCEPTED",
  "SUPPLIER_REVISED_QUOTE_REQUESTED",
  "SUPPLIER_PO_RECEIVED",
  "SUPPLIER_PO_ACCEPTANCE_REQUIRED",
  "SUPPLIER_PO_REMINDER",
  "SUPPLIER_PO_MODIFIED",
  "SUPPLIER_PO_CANCELLED",
  "SUPPLIER_DISPATCH_DUE",
  "SUPPLIER_DISPATCH_OVERDUE",
  "SUPPLIER_DELIVERY_DELAYED",
  "SUPPLIER_PAYMENT_STATUS",
  "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED",
  "SUPPLIER_PRICE_UPDATED",
  "SUPPLIER_SIGNIFICANT_PRICE_CHANGE",
] as const;

export const SOURCING_INTELLIGENCE_EVENT_TYPES = [
  "PRICE_MOVEMENT_ALERT",
  "PRICE_WATCH_THRESHOLD_REACHED",
  "BUYING_OPPORTUNITY",
  "SUPPLIER_PRICE_POSITION",
] as const;

export const AUTHENTICATION_EVENT_TYPES = [
  "PHONE_VERIFICATION_OTP",
  "EMAIL_CHANGE_OTP",
  "PHONE_CHANGE_OTP",
  "SECURITY_ALERT",
] as const;

export const SUMMARY_EVENT_TYPES = [
  "CUSTOMER_WEEKLY_PROCUREMENT_SUMMARY",
  "SUPPLIER_WEEKLY_PERFORMANCE_SUMMARY",
] as const;

export const ALL_NOTIFICATION_EVENT_TYPES = [
  ...CUSTOMER_EVENT_TYPES,
  ...SUPPLIER_EVENT_TYPES,
  ...SOURCING_INTELLIGENCE_EVENT_TYPES,
  ...AUTHENTICATION_EVENT_TYPES,
  ...SUMMARY_EVENT_TYPES,
] as const;

export type NotificationEventType = (typeof ALL_NOTIFICATION_EVENT_TYPES)[number];

/** Authentication/security event types must NEVER be suppressible by the global WhatsApp kill-switch or user preferences. */
export const MANDATORY_EVENT_TYPES: readonly NotificationEventType[] = AUTHENTICATION_EVENT_TYPES;

export function isMandatoryEventType(eventType: string): boolean {
  return (MANDATORY_EVENT_TYPES as readonly string[]).includes(eventType);
}

export type NotificationChannelKey = "WHATSAPP" | "IN_APP";

export type NotificationPriority = "P0" | "P1" | "P2";
