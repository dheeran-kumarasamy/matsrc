import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { SupplierRejectionsService } from "./supplier-rejections.service";

@Controller("admin/supplier-rejections")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class SupplierRejectionsController {
  constructor(private readonly service: SupplierRejectionsService) {}

  @Get()
  findRecent(
    @Query("limit") limit?: string
  ): Promise<
    Array<{
      id: string;
      enquiryId: string;
      supplierId: string | null;
      supplierName: string | null;
      builderName: string | null;
      productName: string | null;
      reason: string | null;
      createdAt: Date;
    }>
  > {
    const parsed = Number(limit || "50");
    return this.service.findRecent(Number.isNaN(parsed) ? 50 : parsed);
  }
}
