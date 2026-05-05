import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { VendorsService } from "./vendors.service";
import { UpdateVendorKycDto } from "./dto/update-vendor-kyc.dto";

@Controller("admin/vendors")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  findAll() {
    return this.vendorsService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.vendorsService.findOne(id);
  }

  @Patch(":id/kyc")
  updateKyc(@Param("id") id: string, @Body() dto: UpdateVendorKycDto, @CurrentUser() user: any) {
    return this.vendorsService.updateKyc(id, dto.status, user.userId, dto.note);
  }
}
