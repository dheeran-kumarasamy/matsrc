import { IsNotEmpty, IsString } from "class-validator";

/** Body for POST /admin/pricing/sku/canonical/:id/merge — merges the SKU in the URL param into targetSkuId. */
export class MergeCanonicalSkuDto {
  @IsString()
  @IsNotEmpty()
  targetSkuId!: string;
}
