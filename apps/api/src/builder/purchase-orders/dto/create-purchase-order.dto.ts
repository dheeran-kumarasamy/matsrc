import { IsNotEmpty, IsString } from "class-validator";

export class CreatePurchaseOrderDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;
}
