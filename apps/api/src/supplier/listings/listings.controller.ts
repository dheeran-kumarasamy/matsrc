import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { CreateListingDto } from "./dto/create-listing.dto";
import { UpdateListingDto } from "./dto/update-listing.dto";
import { ListingsService } from "./listings.service";

@Controller("supplier/listings")
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get()
  findAll() {
    return this.listingsService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.listingsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateListingDto): Promise<{ id: string; name: string; category: string; unit: string }> {
    return this.listingsService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateListingDto): Promise<{ id: string; name: string; unit: string }> {
    return this.listingsService.update(id, dto);
  }
}