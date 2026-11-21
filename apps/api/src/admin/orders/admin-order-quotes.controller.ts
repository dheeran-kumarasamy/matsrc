import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { AdminOrderQuotesService } from "./admin-order-quotes.service";
import { ReviewSupplierQuoteDto } from "./dto/review-supplier-quote.dto";

@Controller("admin/orders")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AdminOrdersListController {
  constructor(private readonly quotesService: AdminOrderQuotesService) {}

  @Get()
  async listOrders() {
    return this.quotesService.listOrders();
  }
}

@Controller("admin/orders/:orderId/quotes")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AdminOrderQuotesController {
  constructor(private readonly quotesService: AdminOrderQuotesService) {}

  @Get()
  async getQuotes(@Param("orderId") orderId: string) {
    return this.quotesService.getQuotes(orderId);
  }

  @Post(":quoteId/review")
  async reviewQuote(
    @Param("orderId") orderId: string,
    @Param("quoteId") quoteId: string,
    @Body() dto: ReviewSupplierQuoteDto,
    @Req() req: any
  ) {
    const adminUserId = req.user?.id || req.user?.userId || "admin";
    return this.quotesService.reviewQuote(orderId, quoteId, dto, adminUserId);
  }
}
