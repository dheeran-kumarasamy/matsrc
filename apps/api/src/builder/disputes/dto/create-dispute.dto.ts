import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateDisputeDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @IsString()
  @IsNotEmpty()
  issueType!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  evidenceUrls?: string[];
}
