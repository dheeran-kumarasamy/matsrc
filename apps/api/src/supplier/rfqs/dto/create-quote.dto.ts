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

// Supplier RFQ Price Revision & GST-Inclusive Order Value (spec §23): the
// submission payload intentionally carries ONLY `lineItemId` + `unitPrice`
// (+ optional currency/leadTimeDays, unchanged from the existing contract)
// per line item. Quantity, GST rate/amount, and every subtotal/grand total
// are deliberately NOT accepted here — the server derives quantity + GST
// rate from the RFQ's own OrderItem row and recalculates every monetary
// total itself (see RfqsService.createEnquiryLineQuotes). A client that
// sends any of those fields anyway has them silently ignored, since this
// DTO (with ValidationPipe's whitelist: true — see apps/api/src/main.ts)
// strips any property not declared on QuoteLineItemDto/CreateQuoteDto.

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