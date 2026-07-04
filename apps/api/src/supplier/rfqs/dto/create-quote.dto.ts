import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class QuoteLineItemDto {
  @IsString()
  @IsNotEmpty()
  lineItemId!: string;

  @IsString()
  @IsNotEmpty()
  unitPrice!: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  leadTimeDays?: number;
}

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemDto)
  @IsOptional()
  lineQuotes?: QuoteLineItemDto[];
}