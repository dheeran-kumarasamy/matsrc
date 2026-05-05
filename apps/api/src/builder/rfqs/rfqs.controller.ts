import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { BuilderRfqsService } from "./rfqs.service";
import { CreateRfqDto } from "./dto/create-rfq.dto";

@Controller("builder/rfqs")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("BUILDER")
export class BuilderRfqsController {
  constructor(private readonly rfqsService: BuilderRfqsService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.rfqsService.findAll(user);
  }

  @Get(":id")
  findOne(
    @CurrentUser() user: any,
    @Param("id") id: string
  ): Promise<{
    id: string;
    materialName: string;
    quantity: string;
    pincode: string;
    notes: string | null;
    quotes: Array<{
      id: string;
      supplierId: string;
      price: number;
      validUntil: Date | null;
      notes: string | null;
      createdAt: Date;
    }>;
    createdAt: Date;
  }> {
    return this.rfqsService.findOne(user, id);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateRfqDto) {
    return this.rfqsService.create(user, dto);
  }
}
