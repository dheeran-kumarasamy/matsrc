import { IsOptional, IsString } from "class-validator";

export class ApprovePurchaseOrderDto {
  @IsOptional()
  @IsString()
  approverName?: string;

  @IsOptional()
  @IsString()
  approverDesignation?: string;
}
