import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { SupplierReportsService } from "./reports.service";

@Controller("supplier/reports")
@UseGuards(OptionalJwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: SupplierReportsService) {}

  @Get("summary")
  getSummary(@Query("range") range: string | undefined, @CurrentUser() user: any) {
    const rangeDays = range?.endsWith("d") ? Number(range.replace("d", "")) : 30;
    return this.reportsService.getSummary(user, Number.isFinite(rangeDays) ? rangeDays : 30);
  }

  @Get("product/:id")
  getByProduct(@Param("id") id: string, @Query("range") range: string | undefined, @CurrentUser() user: any) {
    const rangeDays = range?.endsWith("d") ? Number(range.replace("d", "")) : 30;
    return this.reportsService.getByProduct(user, id, Number.isFinite(rangeDays) ? rangeDays : 30);
  }

  @Get("products")
  listProducts(@CurrentUser() user: any) {
    return this.reportsService.listActiveProductsForReportPicker(user);
  }

  @Get("orders")
  getOrdersByValue(
    @Query("sort") sort: string | undefined,
    @Query("order") order: string | undefined,
    @Query("limit") limit: string | undefined,
    @CurrentUser() user: any
  ) {
    const direction = order === "asc" ? "asc" : "desc";
    const take = Number(limit) > 0 ? Number(limit) : 5;
    return this.reportsService.getOrdersByValue(user, direction, take);
  }
}
