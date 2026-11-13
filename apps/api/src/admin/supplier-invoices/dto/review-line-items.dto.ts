import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";

export class SupplierInvoiceLineReviewDto {
  @IsString()
  orderItemId!: string;

  // Actual invoiced quantity/weight, in the SAME unit as the original order
  // line — see SupplierInvoiceLineItem.actualQuantity's doc comment. Never
  // converted across units by this endpoint.
  @IsNumber()
  @Min(0)
  actualQuantity!: number;

  // Audit fix — unit-of-measure validation: the admin's EXPLICIT
  // acknowledgment that `actualQuantity` above is genuinely expressed in
  // the order's own unit (see SupplierInvoiceLineItem.unitConfirmed /
  // orderUnitLabel doc comments). Optional here (defaults to false) so an
  // admin can save an in-progress review before deciding — but
  // SupplierInvoicesService.confirm() REQUIRES every line's unitConfirmed
  // to be true before an invoice can be confirmed (see its own guard).
  // There is no automatic way to verify this from an opaque uploaded file,
  // so the system requires the human reviewer to say so explicitly rather
  // than silently assuming it.
  @IsOptional()
  @IsBoolean()
  unitConfirmed?: boolean;

  // The rate shown on the supplier's own invoice for this line, if it
  // differs from the agreed OrderItem.unitPrice. Omit/null when the
  // supplier's invoice uses the agreed rate.
  @IsOptional()
  @IsNumber()
  supplierInvoicedUnitPrice?: number | null;

  // An admin's EXPLICIT decision to approve a different rate than the
  // agreed OrderItem.unitPrice. Omitted -> the agreed rate is used
  // regardless of supplierInvoicedUnitPrice (see
  // supplier-invoice-reconciliation.ts's resolveSupplierInvoiceLine).
  @IsOptional()
  @IsNumber()
  approvedUnitPriceOverride?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRatePercent?: number | null;
}

export class ReviewSupplierInvoiceLineItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplierInvoiceLineReviewDto)
  lines!: SupplierInvoiceLineReviewDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  freightChargeAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otherChargesAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  roundingAdjustment?: number;

  @IsOptional()
  @IsString()
  discrepancyNotes?: string | null;
}
