import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString } from "class-validator";
import { ResolutionAction } from "./resolve-anomaly.dto";

const RESOLUTION_ACTIONS = ["accepted", "excluded", "remapped", "source_fixed"] as const;

/** Body for POST /admin/pricing/anomalies/bulk-resolve — resolves many anomalies with the same action/note. */
export class BulkResolveAnomalyDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  anomalyIds!: string[];

  @IsIn(RESOLUTION_ACTIONS)
  action!: ResolutionAction;


  @IsOptional()
  @IsString()
  note?: string;
}

/** Body for POST /admin/pricing/anomalies/:id/comment — adds a note without changing resolution status. */
export class CommentAnomalyDto {
  @IsString()
  note!: string;
}
