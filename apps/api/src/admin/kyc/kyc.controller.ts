import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { KycService } from "./kyc.service";
import { ReviewKycDocumentDto } from "./dto/review-kyc-document.dto";

@Controller("admin/kyc")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Get()
  findAllPending() {
    return this.kycService.findAllPending();
  }

  @Patch(":documentId")
  review(
    @Param("documentId") documentId: string,
    @Body() dto: ReviewKycDocumentDto,
    @CurrentUser() user: any
  ) {
    return this.kycService.review(documentId, dto.verified, user.userId, dto.note);
  }
}
