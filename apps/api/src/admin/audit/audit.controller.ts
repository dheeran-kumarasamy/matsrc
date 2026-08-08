import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { AuditLogEntry, AuditService } from "./audit.service";

@Controller("admin/audit")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  findRecent(
    @Query("limit") limit?: string,
    @Query("category") category?: string,
    @Query("actorId") actorId?: string,
    @Query("action") action?: string,
    @Query("entityId") entityId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ): Promise<AuditLogEntry[]> {
    const parsed = Number(limit || "50");
    return this.auditService.findRecent({
      limit: Number.isNaN(parsed) ? 50 : parsed,
      category: category || undefined,
      actorId: actorId || undefined,
      action: action || undefined,
      entityId: entityId || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  }
}
