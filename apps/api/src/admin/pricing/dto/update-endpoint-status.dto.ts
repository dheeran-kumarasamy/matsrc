import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

const ENDPOINT_STATUS_ACTIONS = ["enable", "disable", "pause", "resume"] as const;
export type EndpointStatusAction = (typeof ENDPOINT_STATUS_ACTIONS)[number];

/**
 * Body for PATCH /admin/pricing/endpoints/:id/status.
 * PricingSourceEndpoint already has a disabledReason column, so "pause" and
 * "disable" both set isEnabled=false + disabledReason (distinguished only by
 * the audit log action name / the reason string), and "enable"/"resume" set
 * isEnabled=true + clear disabledReason + reset consecutiveFailures.
 */
export class UpdateEndpointStatusDto {
  @IsString()
  @IsIn(ENDPOINT_STATUS_ACTIONS)
  action!: EndpointStatusAction;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string;
}
