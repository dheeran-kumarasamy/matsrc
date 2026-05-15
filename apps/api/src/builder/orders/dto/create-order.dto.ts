import { IsDateString, IsEnum, IsOptional } from "class-validator";
import { PaymentMethod } from "@matsrc/db";

export class CreateOrderDto {
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;
}
