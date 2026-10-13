import { Controller, Get, Param, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { AdminRatingsService } from "./ratings.service";

// Admin-only rating-receipt review. Mirrors the existing admin/payments
// controller pattern exactly: OptionalJwtAuthGuard resolves the caller,
// RoleGuard + @Roles("ADMIN") enforces authorization server-side (never
// relies on a hidden frontend button) — a non-admin caller is rejected
// with 403 before any service method runs, including the receipt streamer
// below. SUPER_ADMIN is implicitly allowed too (see RoleGuard's built-in
// bypass).
@Controller("admin/ratings")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AdminRatingsController {
  constructor(private readonly ratingsService: AdminRatingsService) {}

  @Get(":orderId")
  findOne(@Param("orderId") orderId: string) {
    return this.ratingsService.findByOrderId(orderId);
  }

  // Streams the raw receipt bytes to an authorized admin only — never a
  // public/static URL, and never accessible without passing the same
  // OptionalJwtAuthGuard + RoleGuard("ADMIN") checks as every other route
  // on this controller (mirrors PaymentsController.getScreenshot).
  @Get(":orderId/receipt")
  async getReceipt(@Param("orderId") orderId: string, @Res() res: Response) {
    const receipt = await this.ratingsService.getReceipt(orderId);
    res.setHeader("Content-Type", receipt.receiptMimeType);
    res.setHeader("Content-Disposition", `inline; filename="${receipt.receiptFileName}"`);
    // Never cached/publicly stored — this is a private financial document.
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(receipt.receiptData));
  }
}
