import { IsNumber, IsPositive } from "class-validator";

export class RefundPaymentDto {
  @IsNumber()
  @IsPositive()
  refundAmount!: number;
}
