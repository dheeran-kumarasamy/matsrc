import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

const RESOLUTION_ACTIONS = ["accepted", "excluded", "remapped", "source_fixed"] as const;
export type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number];

/**
 * Body for POST /admin/pricing/anomalies/:id/resolve.
 *
 * action:
 *   - "accepted": the flagged observation was actually legitimate — reverses
 *     the paired PricingObservation.isExcluded back to false so it
 *     participates in the next rollup.
 *   - "excluded": the flag was correct; the observation stays excluded.
 *   - "remapped" / "source_fixed": the underlying cause has been corrected
 *     elsewhere (SKU alias fixed, source selector fixed); the observation
 *     itself is left as-is (whatever isExcluded state it already has) since
 *     the fix takes effect on the NEXT normalization/ingestion run, not
 *     retroactively on this row.
 */
export class ResolveAnomalyDto {
  @IsString()
  @IsIn(RESOLUTION_ACTIONS)
  action!: ResolutionAction;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;
}
