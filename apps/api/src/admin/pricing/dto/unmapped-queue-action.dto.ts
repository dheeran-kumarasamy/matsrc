import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

export const UNMAPPED_QUEUE_ACTIONS = ["assign", "merge", "ignore", "block", "create_new_sku"] as const;
export type UnmappedQueueAction = (typeof UNMAPPED_QUEUE_ACTIONS)[number];

/**
 * Body for POST /admin/pricing/sku/unmapped/:id/action
 * - assign / merge: requires canonicalSkuId, sets alias.canonicalSkuId + matchType MANUAL
 * - ignore: marks reviewed without assigning a canonical SKU (skips from default queue view)
 * - block: sets matchType BLOCKED, permanently excluded from suggestions
 * - create_new_sku: requires newSkuCode (+ optional materialCategoryId/baseUnit), creates a PricingCanonicalSku then assigns
 */
export class UnmappedQueueActionDto {
  @IsIn(UNMAPPED_QUEUE_ACTIONS)
  action!: UnmappedQueueAction;

  @IsOptional()
  @IsString()
  canonicalSkuId?: string;

  @IsOptional()
  @IsString()
  newSkuCode?: string;

  @IsOptional()
  @IsString()
  materialCategoryId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

/** Body for POST /admin/pricing/sku/unmapped/bulk-action — applies the same action to many alias ids. */
export class BulkUnmappedQueueActionDto extends UnmappedQueueActionDto {
  @IsString({ each: true })
  aliasIds!: string[];
}
