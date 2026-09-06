import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpdateNotificationPolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(["P0", "P1", "P2"])
  priority?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerDay?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  cooldownMinutes?: number | null;

  @IsOptional()
  @IsBoolean()
  businessHoursOnly?: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateGlobalWhatsAppSettingsDto {
  @IsBoolean()
  whatsappBusinessEnabled!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
