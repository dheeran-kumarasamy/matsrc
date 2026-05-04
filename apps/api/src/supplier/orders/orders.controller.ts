import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { OrdersService } from "./orders.service";

@Controller("supplier/orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll() {
    return this.ordersService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.ordersService.findOne(id);
  }

  @Patch(":id/status")
  updateStatus(@Param("id") id: string, @Body() dto: UpdateOrderStatusDto): Promise<{ id: string; status: UpdateOrderStatusDto["status"] }> {
    return this.ordersService.updateStatus(id, dto.status);
  }
}