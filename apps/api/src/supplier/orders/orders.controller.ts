import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { OrdersService } from "./orders.service";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { CurrentUser } from "src/auth/current-user.decorator";

@Controller("supplier/orders")
@UseGuards(OptionalJwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.ordersService.findAll(user);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: any) {
    return this.ordersService.findOne(id, user);
  }

  @Patch(":id/status")
  updateStatus(@Param("id") id: string, @Body() dto: UpdateOrderStatusDto, @CurrentUser() user: any): Promise<{ id: string; status: UpdateOrderStatusDto["status"] }> {
    return this.ordersService.updateStatus(id, dto.status, user);
  }
}