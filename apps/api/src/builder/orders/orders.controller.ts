import { Body, Controller, Get, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { InvoicesService } from "src/admin/invoices/invoices.service";
import { renderInvoicePdf } from "src/admin/invoices/invoice-pdf.util";
import { mapInvoiceToSiteReceiptSheet } from "src/admin/invoices/site-receipt-sheet-dto";
import { renderSiteReceiptSheetPdf } from "src/admin/invoices/site-receipt-sheet-pdf.util";
import { BuilderContextService } from "src/builder/builder-context.service";
import { BuilderOrdersService } from "./orders.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpsertOrderRatingDto } from "./dto/upsert-order-rating.dto";

@Controller("builder/orders")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("BUILDER")
export class BuilderOrdersController {
  constructor(
    private readonly ordersService: BuilderOrdersService,
    private readonly invoicesService: InvoicesService,
    private readonly builderContext: BuilderContextService
  ) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.ordersService.findAll(user);
  }

  @Get(":id")
  findOne(@CurrentUser() user: any, @Param("id") id: string) {
    return this.ordersService.findOne(user, id);
  }

  @Post("checkout")
  create(@CurrentUser() user: any, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user, dto);
  }

  @Post(":id/rating")
  upsertRating(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: UpsertOrderRatingDto) {
    return this.ordersService.upsertRating(user, id, dto);
  }

  // Contractor/Client view/download of their own generated invoice. Read-only
  // — this Contractor/Client-scoped controller (@Roles("BUILDER")) never
  // exposes generation; only an Admin can generate (see
  // src/admin/invoices/invoices.controller.ts). Access is further scoped to
  // the invoice's own builderId inside InvoicesService.findByOrderIdForUser,
  // so one builder can never view another builder's invoice even by
  // guessing an orderId.
  @Get(":id/invoice")
  async getInvoice(@CurrentUser() user: any, @Param("id") id: string) {
    const { user: builder } = await this.builderContext.getOrCreateBuilder(user.userId, user.email, user.name);
    return this.invoicesService.findByOrderIdForUser(id, { id: builder.id, role: "BUILDER" });
  }

  // PDF download of the same stored invoice snapshot, scoped to the
  // requesting builder's own order (see findByOrderIdForUser's ownership
  // check).
  @Get(":id/invoice/pdf")
  async getInvoicePdf(@CurrentUser() user: any, @Param("id") id: string, @Res() res: Response) {
    const { user: builder } = await this.builderContext.getOrCreateBuilder(user.userId, user.email, user.name);
    const invoice = await this.invoicesService.findByOrderIdForUser(id, { id: builder.id, role: "BUILDER" });
    const buffer = await renderInvoicePdf(invoice);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(buffer);
  }

  // Site Material Receipt & Verification Sheet PDF download, scoped to the
  // requesting builder's own order. Strictly price-free and non-commercial.
  @Get(":id/site-receipt-sheet/pdf")
  async getSiteReceiptSheetPdf(@CurrentUser() user: any, @Param("id") id: string, @Res() res: Response) {
    const { user: builder } = await this.builderContext.getOrCreateBuilder(user.userId, user.email, user.name);
    const invoice = await this.invoicesService.findByOrderIdForUser(id, { id: builder.id, role: "BUILDER" });
    const receiptSheetData = mapInvoiceToSiteReceiptSheet(invoice);
    const buffer = await renderSiteReceiptSheetPdf(receiptSheetData);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${receiptSheetData.receiptSheetNumber.replace(/\//g, "-")}.pdf"`);
    res.send(buffer);
  }
}
