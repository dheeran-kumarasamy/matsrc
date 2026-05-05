import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { WatchlistService } from "./watchlist.service";
import { AddWatchlistItemDto } from "./dto/add-watchlist-item.dto";

@Controller("builder/watchlist")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("BUILDER")
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.watchlistService.findAll(user);
  }

  @Post()
  add(@CurrentUser() user: any, @Body() dto: AddWatchlistItemDto) {
    return this.watchlistService.add(user, dto);
  }

  @Delete(":productId")
  remove(@CurrentUser() user: any, @Param("productId") productId: string) {
    return this.watchlistService.remove(user, productId);
  }
}
