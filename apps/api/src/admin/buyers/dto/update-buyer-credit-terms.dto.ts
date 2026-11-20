import { IsInt, Min } from "class-validator";

export class UpdateBuyerCreditTermsDto {
  @IsInt()
  @Min(0)
  paymentDueDays!: number;
}

