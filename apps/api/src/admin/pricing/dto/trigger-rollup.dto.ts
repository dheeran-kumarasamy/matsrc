import { IsISO8601, IsNotEmpty, IsString } from "class-validator";

/** Body for POST /admin/pricing/rollups/daily. priceDate: "YYYY-MM-DD". */
export class TriggerDailyRollupDto {
  @IsString()
  @IsNotEmpty()
  @IsISO8601({ strict: true })
  priceDate!: string;
}

/** Body for POST /admin/pricing/rollups/monthly. monthStart: "YYYY-MM-DD" (any day in the target month). */
export class TriggerMonthlyRollupDto {
  @IsString()
  @IsNotEmpty()
  @IsISO8601({ strict: true })
  monthStart!: string;
}
