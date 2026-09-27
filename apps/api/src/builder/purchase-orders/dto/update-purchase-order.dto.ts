import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

// NOTE: Quantity is intentionally NOT a field on this DTO. The PO quantity must
// always mirror the confirmed/agreed order quantity (OrderItem.quantity) captured
// when the supplier quote was accepted (see PurchaseOrdersService.create) — it is
// not directly editable via the PO update endpoint. `forbidNonWhitelisted: true`
// (apps/api/src/main.ts) rejects any request that tries to smuggle a `quantity`
// field in here.
export class UpdatePurchaseOrderLineItemDto {
  @IsString()
  id!: string;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;
}

export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePurchaseOrderLineItemDto)
  lineItems?: UpdatePurchaseOrderLineItemDto[];
}
