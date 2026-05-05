import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { DisputesService } from "./disputes.service";
import { UpdateDisputeDto } from "./dto/update-dispute.dto";

@Controller("admin/disputes")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Get()
  findAll(): Promise<
    Array<{
      id: string;
      orderId: string;
      userId: string;
      issueType: string;
      description: string;
      status: string;
      resolution: string | null;
      createdAt: Date;
      updatedAt: Date;
      user: { id: string; name: string | null; email: string | null };
      order: { id: string; status: string; totalAmount: number };
    }>
  > {
    return this.disputesService.findAll();
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateDisputeDto, @CurrentUser() user: any) {
    return this.disputesService.update(id, dto.status, user.userId, dto.resolution);
  }
}
