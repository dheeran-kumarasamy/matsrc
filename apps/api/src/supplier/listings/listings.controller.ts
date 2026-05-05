import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CreateListingDto } from "./dto/create-listing.dto";
import { UpdateListingDto } from "./dto/update-listing.dto";
import { ListingsService } from "./listings.service";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { CurrentUser } from "src/auth/current-user.decorator";

@Controller("supplier/listings")
@UseGuards(OptionalJwtAuthGuard)
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.listingsService.findAll(user);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: any) {
    return this.listingsService.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateListingDto, @CurrentUser() user: any): Promise<{ id: string; name: string; category: string; unit: string }> {
    return this.listingsService.create(dto, user);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateListingDto, @CurrentUser() user: any): Promise<{ id: string; name: string; unit: string }> {
    return this.listingsService.update(id, dto, user);
  }
}