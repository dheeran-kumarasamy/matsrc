import { ProductInterestEventType } from "@matsrc/db";
import { IsEnum, IsNotEmpty, IsString } from "class-validator";

export class RecordInterestEventDto {
  @IsEnum(ProductInterestEventType)
  eventType!: ProductInterestEventType;

  @IsString()
  @IsNotEmpty()
  sessionId!: string;
}
