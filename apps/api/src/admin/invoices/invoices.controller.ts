import { Controller, Get, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { InvoicesService } from "./invoices.service";
import { renderInvoicePdf } from "./invoice-pdf.util";

// Admin-only invoice generation/read endpoints. Mirrors the existing
// admin/payments controller pattern: OptionalJwtAuthGuard resolves the
// caller, RoleGuard + @Roles("ADMIN") enforces authorization server-side —
// a Contractor/Client or Supplier caller is rejected with 403 before any
// service method runs, including the eligibility check below. SUPER_ADMIN
// is implicitly allowed too (see RoleGuard's built-in bypass).
@Controller("admin/orders/:orderId/invoice")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AdminInvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  // Returns whether this order currently satisfies every prerequisite for
  // invoice generation — used by the Admin order detail page to decide
  // whether to render an active "Generate Invoice" button. The frontend
  // check is advisory only; generate() below re-validates everything.
  @Get("eligibility")
  async eligibility(@Param("orderId") orderId: string) {
    const { eligible, reason } = await this.invoicesService.checkEligibility(orderId);
    return { eligible, reason: reason ?? null };
  }

  @Get()
  async getInvoice(@Param("orderId") orderId: string) {
    return this.invoicesService.findByOrderId(orderId);
  }

  // PDF built from the STORED invoice snapshot — never live order/product
  // pricing — so downloading always reproduces the same issued document.
  @Get("pdf")
  async getInvoicePdf(@Param("orderId") orderId: string, @Res() res: Response) {
    const invoice = await this.invoicesService.findByOrderId(orderId);
    const buffer = await renderInvoicePdf(invoice);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(buffer);
  }

  // The single Admin-only "Generate Invoice" action. Idempotent — a repeat
  // call for an order that already has an invoice returns the existing
  // invoice instead of creating a duplicate.
  @Post()
  async generate(@Param("orderId") orderId: string, @CurrentUser() user: any) {
    return this.invoicesService.generate(orderId, user.userId);
  }
}
