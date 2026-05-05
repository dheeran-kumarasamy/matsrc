import { Controller, Get, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { CreditService } from "./credit.service";

@Controller("builder/credit")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("BUILDER")
export class CreditController {
  constructor(private readonly creditService: CreditService) {}

  @Get()
  getSummary(@CurrentUser() user: any) {
    return this.creditService.getSummary(user);
  }
}
