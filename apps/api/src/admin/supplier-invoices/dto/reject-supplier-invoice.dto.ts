import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class RejectSupplierInvoiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
