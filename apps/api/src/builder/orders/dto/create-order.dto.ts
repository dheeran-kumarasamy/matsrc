import { IsDateString, IsEnum, IsOptional, IsString } from "class-validator";
import { PaymentMethod } from "@matsrc/db";

export class CreateOrderDto {
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  // Site-wise purchase reporting: builder-owned Site to tag this enquiry/
  // order to (checkout overlay "Select Site" step — see
  // apps/web/components/orders/SiteSelector.tsx). Optional here so this
  // (currently unused by the web checkout frontend) endpoint stays
  // backward-compatible; ownership is validated in the service when present.
  @IsOptional()
  @IsString()
  siteId?: string;
}
