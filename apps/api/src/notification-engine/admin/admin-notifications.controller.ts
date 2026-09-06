import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { AdminNotificationsService } from "./admin-notifications.service";
import { UpdateGlobalWhatsAppSettingsDto, UpdateNotificationPolicyDto } from "./dto/update-notification-policy.dto";

/**
 * `/admin/notifications` (spec Phase 8) — per-template enable/disable,
 * priority, limits, cooldown, and the global WhatsApp Business Notifications
 * kill-switch. Distinct from `/admin/whatsapp-alerts` (the test-alert page,
 * see AdminWhatsAppTestController). Guarded identically to every other admin
 * surface in this repo (OptionalJwtAuthGuard + RoleGuard + @Roles("ADMIN")).
 */
@Controller("admin/notifications")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AdminNotificationsController {
  constructor(private readonly service: AdminNotificationsService) {}

  @Get("policies")
  listPolicies() {
    return this.service.listPolicies();
  }

  @Get("global-settings")
  getGlobalSettings() {
    return this.service.getGlobalSettings();
  }

  @Patch("policies/:id")
  updatePolicy(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: UpdateNotificationPolicyDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.service.updatePolicy(id, dto, actorId);
  }

  @Patch("global-settings")
  updateGlobalSettings(@CurrentUser() user: any, @Body() dto: UpdateGlobalWhatsAppSettingsDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.service.updateGlobalWhatsAppSettings(dto, actorId);
  }

  @Get("audit")
  listAudits(@Query("policyId") policyId?: string, @Query("limit") limit?: string) {
    const parsed = Number(limit || "100");
    return this.service.listAudits(policyId, Number.isNaN(parsed) ? 100 : parsed);
  }
}
