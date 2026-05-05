import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { UpsertCartItemDto } from "./dto/upsert-cart-item.dto";
import { CartService } from "./cart.service";

@Controller("builder/cart")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("BUILDER")
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.cartService.findAll(user);
  }

  @Post("items")
  upsert(@CurrentUser() user: any, @Body() dto: UpsertCartItemDto) {
    return this.cartService.upsert(user, dto);
  }

  @Delete("items/:productId")
  remove(@CurrentUser() user: any, @Param("productId") productId: string) {
    return this.cartService.remove(user, productId);
  }
}
