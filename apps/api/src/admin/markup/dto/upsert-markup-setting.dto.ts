import { IsBoolean, IsNumber, IsOptional, Min } from "class-validator";

// Admin-Configurable Product Markup — request body for upserting a single
// MarkupSetting row (GLOBAL/CATEGORY/PRODUCT, selected by the controller's
// route params — see markup.controller.ts). `percentage` rejects negative
// values at the transport boundary; NaN/Infinity are rejected by
// class-validator's @IsNumber() itself. No upper ceiling is enforced here —
// see packages/db/lib/markup-calculation.ts's top doc comment for why: no
// maximum-markup business policy has been approved, so one is not invented
// in this DTO either.
export class UpsertMarkupSettingDto {
  @IsNumber()
  @Min(0)
  percentage!: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
