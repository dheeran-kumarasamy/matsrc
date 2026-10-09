import { Body, Controller, Get, Param, Patch, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { AdvancePaymentsService } from "./advance-payments.service";
import { RejectAdvancePaymentDto } from "./dto/reject-advance-payment.dto";

// Admin-only Buildohub Advance Payments queue. Mirrors the existing
// admin/payments controller pattern exactly: OptionalJwtAuthGuard resolves
// the caller, RoleGuard + @Roles("ADMIN") enforces authorization
// server-side — a non-admin caller (including any buyer) is rejected with
// 403 before any service method runs, including the screenshot viewer.
@Controller("admin/advance-payments")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AdvancePaymentsController {
  constructor(private readonly advancePaymentsService: AdvancePaymentsService) {}

  @Get()
  findAll(@Query("status") status?: "PENDING" | "APPROVED" | "REJECTED") {
    return this.advancePaymentsService.findAll(status);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.advancePaymentsService.findOne(id);
  }

  // Streams the raw screenshot bytes to an authorized admin only — never a
  // public/static URL.
  @Get(":id/screenshot")
  async getScreenshot(@Param("id") id: string, @Res() res: Response) {
    const screenshot = await this.advancePaymentsService.getScreenshot(id);
    res.setHeader("Content-Type", screenshot.screenshotMimeType);
    res.setHeader("Content-Disposition", `inline; filename="${screenshot.screenshotFileName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(screenshot.screenshotData));
  }

  @Patch(":id/approve")
  approve(@Param("id") id: string, @CurrentUser() user: any) {
    return this.advancePaymentsService.approve(id, user.userId);
  }

  @Patch(":id/reject")
  reject(@Param("id") id: string, @Body() dto: RejectAdvancePaymentDto, @CurrentUser() user: any) {
    return this.advancePaymentsService.reject(id, user.userId, dto.reason);
  }
}
