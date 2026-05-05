import { IsBoolean, IsOptional, IsString } from "class-validator";

export class ReviewKycDocumentDto {
  @IsBoolean()
  verified!: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
