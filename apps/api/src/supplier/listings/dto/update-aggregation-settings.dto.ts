import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsInt, IsOptional, Min, ValidateNested } from "class-validator";

export class PriceTierDto {
  @IsInt()
  @Min(1)
  minQty!: number;

  @IsInt()
  @Min(0)
  unitPrice!: number;
}

export class UpdateAggregationSettingsDto {
  @IsBoolean()
  aggregationEnabled!: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceTierDto)
  priceTiers?: PriceTierDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultWindowDays?: number;

  @IsOptional()
  zoneRules?: unknown;
}
