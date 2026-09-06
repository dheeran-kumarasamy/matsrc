import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Kept in sync with the Template Registry seed (Phase 15) — the fixed set of Meta templates the Admin test-alert page can exercise. */
export const ADMIN_TEST_ALERT_TEMPLATES = [
  "supplier_quote_alert",
  "customer_order_status",
  "supplier_po_alert",
  "supplier_price_update",
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
