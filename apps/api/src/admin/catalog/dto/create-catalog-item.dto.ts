import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class CreateCatalogItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  // Only used by Unit (short code, e.g. "MT"). Ignored for Category/Brand/Grade.
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
