import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class UpsertOrderRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  deliveryRating!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  qualityRating!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
