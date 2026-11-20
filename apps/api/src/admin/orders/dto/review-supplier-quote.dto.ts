import { IsEnum, IsNumber, IsOptional, IsString, Min } from "class-validator";

export enum ReviewAction {
  SEND_TO_BUYER = "SEND_TO_BUYER",
  REJECT = "REJECT",
}

export class ReviewSupplierQuoteDto {
  @IsEnum(ReviewAction)
  action: ReviewAction;

  @IsOptional()
  @IsNumber()
  @Min(0)
  markupPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  buyerUnitPrice?: number;

  @IsOptional()
  @IsString()
  adminNotes?: string;
}
