import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateQuoteDto {
  @IsString()
  @IsNotEmpty()
  price!: string;

  @IsString()
  @IsOptional()
  validUntil?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}