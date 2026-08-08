import { IsNotEmpty, IsOptional, IsString } from "class-validator";

/** Body for POST /admin/pricing/sku/canonical/:id/rename. */
export class RenameCanonicalSkuDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsOptional()
  @IsString()
  grade?: string;
}
