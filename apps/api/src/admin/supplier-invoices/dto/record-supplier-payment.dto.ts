import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from "class-validator";

// Minimal Supplier Payment Tracking — request body for recording a single
// manually-executed supplier payment against a CONFIRMED SupplierInvoice.
// Mirrors the validation style of ReviewSupplierInvoiceLineItemsDto /
// RejectSupplierInvoiceDto (class-validator, server is the sole source of
// truth — this DTO only rejects obviously-malformed input; the business
// rules "invoice must be CONFIRMED" and "amount must not exceed the
// remaining outstanding balance" are enforced in
// SupplierInvoicesService.recordPayment, never here).
export class RecordSupplierPaymentDto {
  // Strictly positive — @IsPositive() rejects 0 and negative amounts at
  // the validation-pipe boundary before the service even runs. The
  // service additionally re-checks against the remaining outstanding
  // balance (an "excessive" amount is a business-state check, not a
  // syntactic one, so it cannot live in this DTO alone).
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsDateString()
  paymentDate!: string;

  // Reuses the existing PaymentMethod enum values verbatim — never a new,
  // parallel set of method strings.
  @IsOptional()
  @IsIn(["UPI", "CARD", "NET_BANKING", "COD", "CREDIT", "BANK_TRANSFER"])
  paymentMethod?: "UPI" | "CARD" | "NET_BANKING" | "COD" | "CREDIT" | "BANK_TRANSFER";

  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}
