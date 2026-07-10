import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { WhatsAppEscalationsService } from "./whatsapp-escalations.service";

@Controller("admin/whatsapp-escalations")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class WhatsAppEscalationsController {
  constructor(private readonly service: WhatsAppEscalationsService) {}

  @Get()
  findRecent(
    @Query("limit") limit?: string
  ): Promise<
    Array<{
      id: string;
      actorId: string;
      phone: string | null;
      lastMessage: string | null;
      createdAt: Date;
    }>
  > {
    const parsed = Number(limit || "50");
    return this.service.findRecent(Number.isNaN(parsed) ? 50 : parsed);
  }
}
