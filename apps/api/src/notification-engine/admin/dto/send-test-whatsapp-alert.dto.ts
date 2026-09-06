import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Kept in sync with the Template Registry seed (Phase 15) — the fixed set of Meta
 * templates the Admin test-alert page can exercise.
 *
 * NOTE: "supplier_rfq_reminder" replaces the old "supplier_quote_reminder" mapping for
 * the SUPPLIER_RFQ_REMINDER business event (Meta template renamed — see
 * packages/db/scripts/seed-notification-templates.js for the full history/reason).
 */
export const ADMIN_TEST_ALERT_TEMPLATES = [
  "supplier_quote_alert",
  "supplier_rfq_reminder",
  "customer_order_status",
  "supplier_po_alert",
  "supplier_price_update",
  "quote_received",
  "action_reminder_alert",
] as const;

export class SendTestWhatsAppAlertDto {
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  phone!: string;

  @IsString()
  @IsIn(ADMIN_TEST_ALERT_TEMPLATES)
  templateName!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  parameters?: string[];
}
