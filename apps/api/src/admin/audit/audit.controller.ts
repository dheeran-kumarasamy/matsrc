import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { AuditService } from "./audit.service";

@Controller("admin/audit")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  findRecent(
    @Query("limit") limit?: string
  ): Promise<
    Array<{
      id: string;
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      metadata: unknown;
      createdAt: Date;
    }>
  > {
    const parsed = Number(limit || "50");
    return this.auditService.findRecent(Number.isNaN(parsed) ? 50 : parsed);
  }
}
