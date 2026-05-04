import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CreateQuoteDto } from "./dto/create-quote.dto";
import { RfqsService } from "./rfqs.service";

@Controller("supplier/rfqs")
export class RfqsController {
  constructor(private readonly rfqsService: RfqsService) {}

  @Get()
  findAll() {
    return this.rfqsService.findAll();
  }

  @Post(":id/quotes")
  createQuote(@Param("id") id: string, @Body() dto: CreateQuoteDto): Promise<{ id: string; rfqId: string; price: string }> {
    return this.rfqsService.createQuote(id, dto);
  }
}