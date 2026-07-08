import { IsDateString, IsInt, IsNotEmpty, IsString, Min } from "class-validator";

export class OptInDto {
  @IsString()
  @IsNotEmpty()
  supplierId!: string;

  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  zoneKey!: string;

  @IsDateString()
  requestedDeliveryDate!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}
