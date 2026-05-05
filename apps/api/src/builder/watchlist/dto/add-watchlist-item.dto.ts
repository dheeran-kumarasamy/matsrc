import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class AddWatchlistItemDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsString()
  targetPrice?: string;
}
