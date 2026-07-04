import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CreateQuoteDto } from "./dto/create-quote.dto";
import { RfqsService } from "./rfqs.service";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { CurrentUser } from "src/auth/current-user.decorator";

@Controller("supplier/rfqs")
@UseGuards(OptionalJwtAuthGuard)
export class RfqsController {
  constructor(private readonly rfqsService: RfqsService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.rfqsService.findAll(user);
  }

  @Get(":id/quotes")
  findEnquiryQuotes(@Param("id") id: string, @CurrentUser() user: any) {
    return this.rfqsService.findEnquiryQuotes(id, user);
  }

  @Post(":id/quotes")
  createQuote(@Param("id") id: string, @Body() dto: CreateQuoteDto, @CurrentUser() user: any): Promise<{ id: string; rfqId: string; price: string }> {
    return this.rfqsService.createQuote(id, dto, user);
  }
}