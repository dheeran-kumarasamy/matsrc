import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { GstService } from "./gst.service";
import { AdvanceConfigService } from "./advance-config.service";
import { UpsertTaxSettingDto } from "./dto/upsert-tax-setting.dto";
import { UpsertAdvanceConfigDto } from "./dto/upsert-advance-config.dto";

// Product-Level GST / Advance Configuration — admin-only configuration API.
// Mirrors MarkupController's exact guard/role/audit conventions
// (OptionalJwtAuthGuard + RoleGuard + @Roles("ADMIN")) so only an
// authenticated ADMIN/SUPER_ADMIN (RoleGuard treats SUPER_ADMIN as always
// authorized) can read or change GST/advance configuration.
@Controller("admin/gst")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class GstController {
  constructor(
    private readonly gstService: GstService,
    private readonly advanceConfigService: AdvanceConfigService
  ) {}

  // Full configuration view (global + every category/product override) for
  // the admin GST settings screen.
  @Get()
  listAll() {
    return this.gstService.listAll();
  }

  @Get("global")
  getGlobal() {
    return this.gstService.getGlobal();
  }

  @Put("global")
  upsertGlobal(@Body() dto: UpsertTaxSettingDto, @CurrentUser() user: any) {
    return this.gstService.upsertGlobal(dto.percentage, dto.isEnabled, user?.userId ?? "system");
  }

  @Get("category/:categoryId")
  getCategoryOverride(@Param("categoryId") categoryId: string) {
    return this.gstService.getCategoryOverride(categoryId);
  }

  @Put("category/:categoryId")
  upsertCategoryOverride(
    @Param("categoryId") categoryId: string,
    @Body() dto: UpsertTaxSettingDto,
    @CurrentUser() user: any
  ) {
    return this.gstService.upsertCategoryOverride(categoryId, dto.percentage, dto.isEnabled, user?.userId ?? "system");
  }

  @Delete("category/:categoryId")
  deleteCategoryOverride(@Param("categoryId") categoryId: string, @CurrentUser() user: any) {
    return this.gstService.deleteCategoryOverride(categoryId, user?.userId ?? "system");
  }

  @Get("product/:productId")
  getProductOverride(@Param("productId") productId: string) {
    return this.gstService.getProductOverride(productId);
  }

  @Put("product/:productId")
  upsertProductOverride(
    @Param("productId") productId: string,
    @Body() dto: UpsertTaxSettingDto,
    @CurrentUser() user: any
  ) {
    return this.gstService.upsertProductOverride(productId, dto.percentage, dto.isEnabled, user?.userId ?? "system");
  }

  @Delete("product/:productId")
  deleteProductOverride(@Param("productId") productId: string, @CurrentUser() user: any) {
    return this.gstService.deleteProductOverride(productId, user?.userId ?? "system");
  }

  // "Understand which rule is currently effective for a product, and why"
  // — admin visibility requirement (reports every tier's ACTIVE/DISABLED/
  // INVALID/UNSET status, not just the winner).
  @Get("product/:productId/effective")
  getEffectiveForProduct(@Param("productId") productId: string) {
    return this.gstService.getEffectiveForProduct(productId);
  }

  // Product Tax-Coverage Worklist — identifies products lacking a valid
  // effective GST rate (would block a future confirmation flow).
  @Get("coverage")
  listTaxCoverage(
    @Query("categoryId") categoryId?: string,
    @Query("search") search?: string,
    @Query("onlyMissing") onlyMissing?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.gstService.listTaxCoverage({
      categoryId,
      search,
      onlyMissing: onlyMissing === "true",
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  // Global Advance Configuration (AdvanceConfig singleton) — informational
  // only, see AdvanceConfigService's doc comment.
  @Get("advance-config")
  getAdvanceConfig() {
    return this.advanceConfigService.get();
  }

  @Put("advance-config")
  upsertAdvanceConfig(@Body() dto: UpsertAdvanceConfigDto, @CurrentUser() user: any) {
    return this.advanceConfigService.upsert(dto.percentage, dto.isEnabled, user?.userId ?? "system");
  }
}
