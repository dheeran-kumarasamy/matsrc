import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { BuilderDisputesService } from "./disputes.service";
import { CreateDisputeDto } from "./dto/create-dispute.dto";

@Controller("builder/disputes")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("BUILDER")
export class BuilderDisputesController {
  constructor(private readonly disputesService: BuilderDisputesService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.disputesService.findAll(user);
  }

  @Get(":id")
  findOne(@CurrentUser() user: any, @Param("id") id: string) {
    return this.disputesService.findOne(user, id);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateDisputeDto) {
    return this.disputesService.create(user, dto);
  }
}
