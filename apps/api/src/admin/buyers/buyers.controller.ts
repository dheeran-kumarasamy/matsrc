import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { Role } from "@matsrc/db";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { BuyersService } from "./buyers.service";
import { UpdateBuyerCreditTermsDto } from "./dto/update-buyer-credit-terms.dto";

@Controller("admin/buyers")
@UseGuards(RoleGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class BuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @Get()
  async findAll() {
    return this.buyersService.findAll();
  }

  @Patch(":id/credit-terms")
  async updateCreditTerms(@Param("id") id: string, @Body() dto: UpdateBuyerCreditTermsDto) {
    return this.buyersService.updateCreditTerms(id, dto.paymentDueDays);
  }
}

