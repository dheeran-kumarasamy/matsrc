import { Controller, Get, Param, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { AdminRfqPdfService } from "./rfq-pdf.service";

// Admin-only RFQ PDF download — accessible independently of invoicing or
// payment (unlike AdminInvoicesController, which requires an issued
// Invoice first). Mirrors AdminInvoicesController's own guard/role
// conventions exactly: OptionalJwtAuthGuard resolves the caller,
// RoleGuard + @Roles("ADMIN") rejects any non-admin caller with 403 before
// the service method ever runs. SUPER_ADMIN is implicitly allowed too (see
// RoleGuard's built-in bypass).
@Controller("admin/orders/:orderId/rfq")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AdminRfqPdfController {
  constructor(private readonly rfqPdfService: AdminRfqPdfService) {}

  @Get()
  async getRfq(@Param("orderId") orderId: string) {
    return this.rfqPdfService.getSummary(orderId);
  }

  @Get("pdf")
  async getRfqPdf(@Param("orderId") orderId: string, @Res() res: Response) {
    const { buffer, filename } = await this.rfqPdfService.renderPdf(orderId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
