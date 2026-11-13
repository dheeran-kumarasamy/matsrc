import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class RejectAdvancePaymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
