import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { AdminWhatsAppTestService } from "./admin-whatsapp-test.service";
import { SendTestWhatsAppAlertDto } from "./dto/send-test-whatsapp-alert.dto";

/**
 * `/admin/whatsapp-alerts` (spec Phase 10) — the Admin WhatsApp test page:
 * send a test template alert to a phone number and view recent
 * `WhatsAppMessageLog` rows + the current WhatsApp mode (live/dry-run/off).
 * Distinct from the pre-existing `/admin/whatsapp-escalations`
 * (human-handoff escalations from the Supplier bot) and from
 * `/admin/notifications` (business policy management).
 */
@Controller("admin/whatsapp-alerts")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AdminWhatsAppTestController {
  constructor(private readonly service: AdminWhatsAppTestService) {}

  @Get("mode")
  getMode() {
    return { mode: this.service.getMode() };
  }

  @Post("test-alert")
  async sendTestAlert(@Body() dto: SendTestWhatsAppAlertDto) {
    const result = await this.service.sendTestAlert(dto.phone, dto.templateName, dto.parameters ?? []);
    // Never leak internal/provider error internals beyond what's already
    // safe (errorDetails never contains the access token — see
    // WhatsappNotificationService).
    return result;
  }

  @Get("logs")
  listRecentLogs(@Query("limit") limit?: string) {
    const parsed = Number(limit || "50");
    return this.service.listRecentLogs(Number.isNaN(parsed) ? 50 : parsed);
  }
}
