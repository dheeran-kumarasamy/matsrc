import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { PurchaseOrdersService } from "./purchase-orders.service";
import { CreatePurchaseOrderDto } from "./dto/create-purchase-order.dto";
import { UpdatePurchaseOrderDto } from "./dto/update-purchase-order.dto";
import { ApprovePurchaseOrderDto } from "./dto/approve-purchase-order.dto";

@Controller("builder/purchase-orders")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("BUILDER")
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query("status") status?: string) {
    return this.purchaseOrdersService.findAll(user, status);
  }

  @Get(":id")
  findOne(@CurrentUser() user: any, @Param("id") id: string) {
    return this.purchaseOrdersService.findOne(user, id);
  }

  @Get(":id/export")
  exportPo(@CurrentUser() user: any, @Param("id") id: string) {
    return this.purchaseOrdersService.exportPo(user, id);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrdersService.create(user, dto);
  }

  @Patch(":id")
  update(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: UpdatePurchaseOrderDto) {
    return this.purchaseOrdersService.update(user, id, dto);
  }

  @Post(":id/approve")
  approve(
    @CurrentUser() user: any,
    @Param("id") id: string,
    @Body() dto: ApprovePurchaseOrderDto,
    @Req() req: any
  ) {
    const ip = (req?.headers?.["x-forwarded-for"] as string) || req?.ip;
    const userAgent = req?.headers?.["user-agent"];
    return this.purchaseOrdersService.approve(user, id, dto, { ip, userAgent });
  }
}
