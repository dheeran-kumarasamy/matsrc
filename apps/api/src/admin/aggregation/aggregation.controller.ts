import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { AggregationService } from "src/aggregation/aggregation.service";
import { AggregationPoolStatus } from "@matsrc/db";
import { OverrideClosePoolDto } from "./dto/override-close-pool.dto";

@Controller("admin/aggregation")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AdminAggregationController {
  constructor(private readonly aggregationService: AggregationService) {}

  @Get("pools")
  getPools(
    @Query("status") status?: AggregationPoolStatus,
    @Query("zoneKey") zoneKey?: string,
    @Query("productId") productId?: string,
    @Query("supplierId") supplierId?: string
  ) {
    return this.aggregationService.getAdminPools({
      status,
      zoneKey,
      productId,
      supplierId,
    });
  }

  @Post("pools/:id/override-close")
  overrideClose(
    @CurrentUser() user: any,
    @Param("id") id: string,
    @Body() dto: OverrideClosePoolDto
  ) {
    return this.aggregationService.overrideClosePool(id, user.userId, dto.reason);
  }
}
