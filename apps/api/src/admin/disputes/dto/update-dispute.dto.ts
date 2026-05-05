import { DisputeStatus } from "@matsrc/db";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class UpdateDisputeDto {
  @IsEnum(DisputeStatus)
  status!: DisputeStatus;

  @IsOptional()
  @IsString()
  resolution?: string;
}
