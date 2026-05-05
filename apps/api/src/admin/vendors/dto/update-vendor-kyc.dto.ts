import { KycStatus } from "@matsrc/db";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class UpdateVendorKycDto {
  @IsEnum(KycStatus)
  status!: KycStatus;

  @IsOptional()
  @IsString()
  note?: string;
}
