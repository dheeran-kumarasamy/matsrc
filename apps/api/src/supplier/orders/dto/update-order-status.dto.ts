import { IsEnum } from "class-validator";
import { OrderStatus } from "@matsrc/db";

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}