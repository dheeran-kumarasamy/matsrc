import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

const SOURCE_STATUS_ACTIONS = ["enable", "disable", "pause", "resume"] as const;
export type SourceStatusAction = (typeof SOURCE_STATUS_ACTIONS)[number];

/**
 * Body for PATCH /admin/pricing/sources/:id/status.
 *
 * "enable"/"resume" both set PricingSource.isEnabled = true (resume is the
 * same operation as enable, semantically distinguished only in the audit
 * log action name — this schema has no separate PAUSED state, so pausing
 * is modeled as isEnabled=false + disabledReason="paused_by_admin", the
 * same underlying field disabling uses, to avoid a Prisma schema change).
 */
export class UpdateSourceStatusDto {
  @IsString()
  @IsIn(SOURCE_STATUS_ACTIONS)
  action!: SourceStatusAction;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string;
}
