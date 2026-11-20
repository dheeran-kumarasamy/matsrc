import { IsDateString, IsNotEmpty, IsNumber, IsString, Min } from "class-validator";

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

  @IsNumber()
  @Min(0.0001)
  quantity!: number;
}
