import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { IciciPaymentsService } from "./icici-payments.service";
import { RefundPaymentDto } from "./dto/refund-payment.dto";

// ICICI Bank Payment Gateway — UAT ONLY. Admin-only read visibility (task
// §26) + refund (task §27). Mirrors the existing admin/payments controller's
// guard pattern exactly: OptionalJwtAuthGuard resolves the caller, RoleGuard
// + @Roles("ADMIN") enforces authorization server-side.
@Controller("admin/icici-payments")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class IciciPaymentsController {
  constructor(private readonly iciciPaymentsService: IciciPaymentsService) {}

  @Get()
  findAll() {
    return this.iciciPaymentsService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.iciciPaymentsService.findOne(id);
  }

  @Patch(":id/refund")
  refund(@Param("id") id: string, @Body() dto: RefundPaymentDto, @CurrentUser() user: any) {
    return this.iciciPaymentsService.refund(id, user.userId, dto.refundAmount);
  }
}
