import { Body, Controller, Delete, Get, Param, Put, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { MarkupService } from "./markup.service";
import { UpsertMarkupSettingDto } from "./dto/upsert-markup-setting.dto";

// Admin-Configurable Product Markup — admin-only configuration API.
// Mirrors CatalogController's exact guard/role/audit conventions
// (OptionalJwtAuthGuard + RoleGuard + @Roles("ADMIN")) so only an
// authenticated ADMIN/SUPER_ADMIN (RoleGuard treats SUPER_ADMIN as always
// authorized) can read or change markup configuration.
@Controller("admin/markup")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class MarkupController {
  constructor(private readonly markupService: MarkupService) {}

  // Full configuration view (global + every category/product override) for
  // the admin markup settings screen.
  @Get()
  listAll() {
    return this.markupService.listAll();
  }

  @Get("global")
  getGlobal() {
    return this.markupService.getGlobal();
  }

  @Put("global")
  upsertGlobal(@Body() dto: UpsertMarkupSettingDto, @CurrentUser() user: any) {
    return this.markupService.upsertGlobal(dto.percentage, dto.isEnabled, user?.userId ?? "system");
  }

  @Get("category/:categoryId")
  getCategoryOverride(@Param("categoryId") categoryId: string) {
    return this.markupService.getCategoryOverride(categoryId);
  }

  @Put("category/:categoryId")
  upsertCategoryOverride(
    @Param("categoryId") categoryId: string,
    @Body() dto: UpsertMarkupSettingDto,
    @CurrentUser() user: any
  ) {
    return this.markupService.upsertCategoryOverride(categoryId, dto.percentage, dto.isEnabled, user?.userId ?? "system");
  }

  @Delete("category/:categoryId")
  deleteCategoryOverride(@Param("categoryId") categoryId: string, @CurrentUser() user: any) {
    return this.markupService.deleteCategoryOverride(categoryId, user?.userId ?? "system");
  }

  @Get("product/:productId")
  getProductOverride(@Param("productId") productId: string) {
    return this.markupService.getProductOverride(productId);
  }

  @Put("product/:productId")
  upsertProductOverride(
    @Param("productId") productId: string,
    @Body() dto: UpsertMarkupSettingDto,
    @CurrentUser() user: any
  ) {
    return this.markupService.upsertProductOverride(productId, dto.percentage, dto.isEnabled, user?.userId ?? "system");
  }

  @Delete("product/:productId")
  deleteProductOverride(@Param("productId") productId: string, @CurrentUser() user: any) {
    return this.markupService.deleteProductOverride(productId, user?.userId ?? "system");
  }

  // "Understand which rule is currently effective for a product" — admin
  // visibility requirement.
  @Get("product/:productId/effective")
  getEffectiveForProduct(@Param("productId") productId: string) {
    return this.markupService.getEffectiveForProduct(productId);
  }
}
