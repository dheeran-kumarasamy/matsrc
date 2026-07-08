import { IsNotEmpty, IsString } from "class-validator";

export class OverrideClosePoolDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
