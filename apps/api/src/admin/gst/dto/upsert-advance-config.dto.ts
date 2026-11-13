import { IsBoolean, IsNumber, IsOptional, Min } from "class-validator";

// Global Advance Configuration — request body for upserting the singleton
// AdvanceConfig row. Informational only (see AdvanceConfig's schema doc
// comment): this percentage NEVER gates order confirmation, NEVER debits a
// wallet, and NEVER makes advance payment mandatory — it only feeds the
// `requiredAdvanceAmount` figure displayed to the buyer (see
// packages/db/lib/order-payable-calculation.ts's calculateRequiredAdvanceAmount).
export class UpsertAdvanceConfigDto {
  @IsNumber()
  @Min(0)
  percentage!: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
