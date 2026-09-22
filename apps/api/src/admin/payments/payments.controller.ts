import { Body, Controller, Get, Param, Patch, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { PaymentsService } from "./payments.service";
import { RejectPaymentDto } from "./dto/reject-payment.dto";

// Admin-only payment-verification queue (bank-transfer proof review).
// Mirrors the existing admin/kyc and admin/disputes controller pattern:
// OptionalJwtAuthGuard resolves the caller, RoleGuard + @Roles("ADMIN")
// enforces authorization server-side (never relies on a hidden frontend
// button) — a non-admin caller is rejected with 403 before any service
// method runs, including the screenshot viewer below.
@Controller("admin/payments")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get("pending")
  findPending() {
    return this.paymentsService.findPendingVerifications();
  }

  @Get(":orderId")
  findOne(@Param("orderId") orderId: string) {
    return this.paymentsService.findOne(orderId);
  }

  // Streams the raw screenshot bytes to an authorized admin only — never a
  // public/static URL, and never accessible without passing the same
  // OptionalJwtAuthGuard + RoleGuard("ADMIN") checks as every other route
  // on this controller.
  @Get(":orderId/screenshot")
  async getScreenshot(@Param("orderId") orderId: string, @Res() res: Response) {
    const screenshot = await this.paymentsService.getScreenshot(orderId);
    res.setHeader("Content-Type", screenshot.screenshotMimeType);
    res.setHeader("Content-Disposition", `inline; filename="${screenshot.screenshotFileName}"`);
    // Never cached/publicly stored — this is sensitive banking evidence.
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(screenshot.screenshotData));
  }

  @Patch(":orderId/approve")
  approve(@Param("orderId") orderId: string, @CurrentUser() user: any) {
    return this.paymentsService.approve(orderId, user.userId);
  }

  @Patch(":orderId/reject")
  reject(@Param("orderId") orderId: string, @Body() dto: RejectPaymentDto, @CurrentUser() user: any) {
    return this.paymentsService.reject(orderId, user.userId, dto.reason);
  }
}
