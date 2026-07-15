import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { CatalogEntity, CatalogService } from "./catalog.service";
import { CreateCatalogItemDto } from "./dto/create-catalog-item.dto";
import { UpdateCatalogItemDto } from "./dto/update-catalog-item.dto";

const VALID_ENTITIES: CatalogEntity[] = ["category", "brand", "grade", "unit"];

function assertEntity(entity: string): CatalogEntity {
  if (!VALID_ENTITIES.includes(entity as CatalogEntity)) {
    throw new BadRequestException(`Unknown catalog entity: ${entity}`);
  }
  return entity as CatalogEntity;
}

@Controller("admin/catalog")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get(":entity")
  findAll(@Param("entity") entity: string) {
    return this.catalogService.findAll(assertEntity(entity));
  }

  @Get(":entity/:id")
  findOne(@Param("entity") entity: string, @Param("id") id: string) {
    return this.catalogService.findOne(assertEntity(entity), id);
  }

  @Post(":entity")
  create(@Param("entity") entity: string, @Body() dto: CreateCatalogItemDto, @CurrentUser() user: any) {
    return this.catalogService.create(assertEntity(entity), dto, user?.userId ?? "system");
  }

  @Patch(":entity/:id")
  update(
    @Param("entity") entity: string,
    @Param("id") id: string,
    @Body() dto: UpdateCatalogItemDto,
    @CurrentUser() user: any
  ) {
    return this.catalogService.update(assertEntity(entity), id, dto, user?.userId ?? "system");
  }

  @Delete(":entity/:id")
  deactivate(@Param("entity") entity: string, @Param("id") id: string, @CurrentUser() user: any) {
    return this.catalogService.deactivate(assertEntity(entity), id, user?.userId ?? "system");
  }
}
