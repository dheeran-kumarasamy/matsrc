import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { SupplierInvoicesService } from "./supplier-invoices.service";
import { RejectSupplierInvoiceDto } from "./dto/reject-supplier-invoice.dto";
import { ReviewSupplierInvoiceLineItemsDto } from "./dto/review-line-items.dto";
import { RecordSupplierPaymentDto } from "./dto/record-supplier-payment.dto";

// Admin-only Supplier Invoice review/confirmation queue. Mirrors the
// existing admin/advance-payments controller pattern exactly:
// OptionalJwtAuthGuard resolves the caller, RoleGuard + @Roles("ADMIN")
// enforces authorization server-side — a Supplier or Builder/Contractor
// caller is rejected with 403 before any service method runs, including
// the file viewer (so a supplier can never view another supplier's
// uploaded invoice through this admin-only surface, and no supplier/buyer
// ever sees another party's invoice here).
@Controller("admin/supplier-invoices")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class SupplierInvoicesController {
  constructor(private readonly supplierInvoicesService: SupplierInvoicesService) {}

  @Get()
  findAll(@Query("status") status?: "PENDING_REVIEW" | "REJECTED" | "CONFIRMED") {
    return this.supplierInvoicesService.findAll(status);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.supplierInvoicesService.findOne(id);
  }

  // Streams the ORIGINAL supplier-invoice bytes to an authorized admin
  // only — never a public/static URL.
  @Get(":id/file")
  async getFile(@Param("id") id: string, @Res() res: Response) {
    const file = await this.supplierInvoicesService.getFile(id);
    res.setHeader("Content-Type", file.fileMimeType);
    res.setHeader("Content-Disposition", `inline; filename="${file.fileName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(file.fileData));
  }

  @Patch(":id/reject")
  reject(@Param("id") id: string, @Body() dto: RejectSupplierInvoiceDto, @CurrentUser() user: any) {
    return this.supplierInvoicesService.reject(id, user.userId, dto.reason);
  }

  @Patch(":id/review")
  reviewLineItems(@Param("id") id: string, @Body() dto: ReviewSupplierInvoiceLineItemsDto) {
    return this.supplierInvoicesService.reviewLineItems(id, dto);
  }

  @Post(":id/confirm")
  confirm(@Param("id") id: string, @CurrentUser() user: any) {
    return this.supplierInvoicesService.confirm(id, user.userId);
  }

  // Minimal Supplier Payment Tracking — admin-only, same guards as every
  // other route on this controller (@Roles("ADMIN") above the class).
  @Get(":id/payments")
  getPaymentSummary(@Param("id") id: string) {
    return this.supplierInvoicesService.getPaymentSummary(id);
  }

  @Post(":id/payments")
  recordPayment(@Param("id") id: string, @Body() dto: RecordSupplierPaymentDto, @CurrentUser() user: any) {
    return this.supplierInvoicesService.recordPayment(id, user.userId, dto);
  }
}
