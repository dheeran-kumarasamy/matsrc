import { IsBoolean, IsNumber, IsOptional, Min } from "class-validator";

// Product-Level GST — request body for upserting a single TaxSetting row
// (GLOBAL/CATEGORY/PRODUCT, selected by the controller's route params —
// see gst.controller.ts). Mirrors UpsertMarkupSettingDto exactly:
// `percentage` rejects negative values at the transport boundary;
// NaN/Infinity are rejected by class-validator's @IsNumber() itself. No
// upper ceiling is enforced here — see packages/db/lib/gst-rate-resolution.ts's
// top doc comment: no statutory-maximum business policy has been approved,
// so none is invented in this DTO either.
export class UpsertTaxSettingDto {
  @IsNumber()
  @Min(0)
  percentage!: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
