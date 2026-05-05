import { IsDateString, IsEnum, IsOptional } from "class-validator";
import { PaymentMethod } from "@matsrc/db";

export class CreateOrderDto {
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;
}
