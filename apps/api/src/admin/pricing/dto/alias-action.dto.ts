import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

export const ALIAS_ACTIONS = ["approve", "reject", "block"] as const;
export type AliasAction = (typeof ALIAS_ACTIONS)[number];

/**
 * Body for POST /admin/pricing/sku/alias/:id/action
 * - approve: requires canonicalSkuId (never auto-approved; admin must explicitly confirm the mapping)
 * - reject: clears any suggested mapping, leaves alias unmapped for further review
 * - block: marks the alias as permanently blocked (matchType BLOCKED), excluded from future auto-suggestions
 */
export class AliasActionDto {
  @IsIn(ALIAS_ACTIONS)
  action!: AliasAction;

  @IsOptional()
  @IsString()
  canonicalSkuId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
