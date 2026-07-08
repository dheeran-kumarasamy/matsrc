import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { BuilderContextService } from "src/builder/builder-context.service";
import { AggregationService } from "src/aggregation/aggregation.service";
import { OptInDto } from "./dto/opt-in.dto";

@Controller("builder/aggregation")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("BUILDER")
export class BuilderAggregationController {
  constructor(
    private readonly aggregationService: AggregationService,
    private readonly builderContext: BuilderContextService
  ) {}

  @Post("opt-in")
  async optIn(@CurrentUser() currentUser: any, @Body() dto: OptInDto) {
    const { user } = await this.builderContext.getOrCreateBuilder(
      currentUser.userId,
      currentUser.email,
      currentUser.name
    );

    const pool = await this.aggregationService.findOrCreatePool({
      supplierId: dto.supplierId,
      productId: dto.productId,
      zoneKey: dto.zoneKey,
      requestedDeliveryDate: new Date(dto.requestedDeliveryDate),
    });

    return this.aggregationService.addParticipant({
      poolId: pool.id,
      builderId: user.id,
      quantity: dto.quantity,
    });
  }

  @Get("my-pools")
  async myPools(@CurrentUser() currentUser: any) {
    const { user } = await this.builderContext.getOrCreateBuilder(
      currentUser.userId,
      currentUser.email,
      currentUser.name
    );

    return this.aggregationService.getMyPools(user.id);
  }

  @Get("pools/:id")
  getPool(@Param("id") id: string) {
    return this.aggregationService.getPool(id);
  }

  @Post("pools/:id/opt-out")
  async optOut(@CurrentUser() currentUser: any, @Param("id") id: string) {
    const { user } = await this.builderContext.getOrCreateBuilder(
      currentUser.userId,
      currentUser.email,
      currentUser.name
    );

    return this.aggregationService.cancelParticipant(id, user.id);
  }
}
