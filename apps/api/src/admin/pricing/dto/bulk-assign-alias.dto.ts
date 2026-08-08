import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

/** Body for POST /admin/pricing/sku/alias/bulk-assign — assigns many aliases to a single canonical SKU. */
export class BulkAssignAliasDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  aliasIds!: string[];

  @IsString()
  @IsNotEmpty()
  canonicalSkuId!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
