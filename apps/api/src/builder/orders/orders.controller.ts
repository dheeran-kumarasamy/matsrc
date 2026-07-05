import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { BuilderOrdersService } from "./orders.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpsertOrderRatingDto } from "./dto/upsert-order-rating.dto";

@Controller("builder/orders")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("BUILDER")
export class BuilderOrdersController {
  constructor(private readonly ordersService: BuilderOrdersService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.ordersService.findAll(user);
  }

  @Get(":id")
  findOne(@CurrentUser() user: any, @Param("id") id: string) {
    return this.ordersService.findOne(user, id);
  }

  @Post("checkout")
  create(@CurrentUser() user: any, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user, dto);
  }

  @Post(":id/rating")
  upsertRating(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: UpsertOrderRatingDto) {
    return this.ordersService.upsertRating(user, id, dto);
  }
}
