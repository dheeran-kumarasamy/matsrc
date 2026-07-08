import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { SupplierContextService } from "src/supplier/supplier-context.service";
import { AggregationService } from "src/aggregation/aggregation.service";
import { AggregationPoolStatus } from "@matsrc/db";

@Controller("supplier/aggregation")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("SUPPLIER")
export class SupplierAggregationController {
  constructor(
    private readonly aggregationService: AggregationService,
    private readonly supplierContext: SupplierContextService
  ) {}

  @Get("pools")
  async getPools(
    @CurrentUser() currentUser: any,
    @Query("status") status?: AggregationPoolStatus,
    @Query("zoneKey") zoneKey?: string,
    @Query("productId") productId?: string
  ) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(
      currentUser.userId,
      currentUser.email,
      currentUser.name
    );

    return this.aggregationService.getSupplierPools(supplierProfile.id, {
      status,
      zoneKey,
      productId,
    });
  }

  @Post("pools/:id/force-lock")
  async forceLock(@CurrentUser() currentUser: any, @Param("id") id: string) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(
      currentUser.userId,
      currentUser.email,
      currentUser.name
    );

    return this.aggregationService.forceLockPool(id, supplierProfile.id);
  }
}
