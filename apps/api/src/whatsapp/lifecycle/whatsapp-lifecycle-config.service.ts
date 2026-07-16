import { Injectable } from "@nestjs/common";

/**
 * Central, env-var-backed configuration for the outbound WhatsApp lifecycle
 * notifications (order/enquiry-lifecycle Utility templates for Builders and Suppliers —
 * distinct from the inbound bot flows and from the `notifications/whatsapp-alerts`
 * business-alert channel). Every threshold and Meta template name is overridable so
 * nothing is hardcoded (per spec §F).
 */
@Injectable()
export class WhatsAppLifecycleConfigService {
  /** Master on/off switch for the whole lifecycle-notification feature. */
  isEnabled(): boolean {
    return process.env.WHATSAPP_LIFECYCLE_ENABLED !== "false";
  }

  /** Hours an enquiry can sit in PLACED before the "pending update" nudge fires. */
  getEnquiryNudgeThresholdHours(): number {
    return this.getPositiveNumber("WHATSAPP_ENQUIRY_NUDGE_THRESHOLD_HOURS", 4);
  }

  /** How often (ms) the enquiry-nudge sweep runs. */
  getEnquiryNudgeSweepIntervalMs(): number {
    return this.getPositiveNumber("WHATSAPP_ENQUIRY_NUDGE_SWEEP_INTERVAL_MS", 15 * 60 * 1000);
  }

  /** How often (ms) the daily supplier-digest job runs (checked against the configured hour). */
  getDailyDigestSweepIntervalMs(): number {
    return this.getPositiveNumber("WHATSAPP_DAILY_DIGEST_SWEEP_INTERVAL_MS", 30 * 60 * 1000);
  }

  /** Hour of day (0-23, server local time) the daily supplier digest should fire. */
  getDailyDigestHour(): number {
    const raw = process.env.WHATSAPP_DAILY_DIGEST_HOUR;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 9; // default 9am
  }

  languageCode(): string {
    return process.env.WHATSAPP_LIFECYCLE_LANGUAGE || "en";
  }

  /** Meta template names — each overridable so Meta approvals can rename freely. */
  getTemplateName(key: LifecycleTemplateKey): string {
    const envKey = `WHATSAPP_TEMPLATE_${key.toUpperCase()}`;
    return process.env[envKey] || DEFAULT_TEMPLATE_NAMES[key];
  }

  private getPositiveNumber(envVar: string, fallback: number): number {
    const raw = process.env[envVar];
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}

export type LifecycleTemplateKey =
  | "builder_order_placed"
  | "builder_enquiry_pending_update"
  | "builder_order_accepted"
  | "builder_po_issued"
  | "builder_payment_link_cash"
  | "builder_payment_link_bnpl_credit"
  | "builder_delivery_eta"
  | "builder_order_dispatched"
  | "builder_order_out_for_delivery"
  | "builder_order_delivered"
  | "supplier_new_enquiry_notification"
  | "supplier_pending_enquiries_reminder"
  | "supplier_pending_deliveries_reminder"
  | "supplier_invoice_generated";

const DEFAULT_TEMPLATE_NAMES: Record<LifecycleTemplateKey, string> = {
  builder_order_placed: "builder_order_placed",
  builder_enquiry_pending_update: "builder_enquiry_pending_update",
  builder_order_accepted: "builder_order_accepted",
  builder_po_issued: "builder_po_issued",
  builder_payment_link_cash: "builder_payment_link",
  builder_payment_link_bnpl_credit: "builder_payment_link",
  builder_delivery_eta: "builder_delivery_eta",
  builder_order_dispatched: "builder_order_dispatched",
  builder_order_out_for_delivery: "builder_order_out_for_delivery",
  builder_order_delivered: "builder_order_delivered",
  supplier_new_enquiry_notification: "supplier_new_enquiry_notification",
  supplier_pending_enquiries_reminder: "supplier_pending_enquiries_reminder",
  supplier_pending_deliveries_reminder: "supplier_pending_deliveries_reminder",
  supplier_invoice_generated: "supplier_invoice_generated",
};
