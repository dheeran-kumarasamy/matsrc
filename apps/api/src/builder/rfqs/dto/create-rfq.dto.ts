import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateRfqDto {
  @IsString()
  @IsNotEmpty()
  materialName!: string;

  @IsString()
  @IsNotEmpty()
  quantity!: string;

  @IsString()
  @IsNotEmpty()
  pincode!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
