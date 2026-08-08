import { IsOptional, IsString } from "class-validator";

/** Body for POST /admin/pricing/endpoints/:id/ingest. All fields optional. */
export class TriggerIngestDto {
  @IsOptional()
  @IsString()
  triggeredBy?: string;
}
