import { Module } from "@nestjs/common";
import { MarkupModule } from "src/admin/markup/markup.module";
import { AdminRfqPdfController } from "./rfq-pdf.controller";
import { AdminRfqPdfService } from "./rfq-pdf.service";
import { AdminOrderQuotesController } from "./admin-order-quotes.controller";
import { AdminOrderQuotesService } from "./admin-order-quotes.service";

@Module({
  imports: [MarkupModule],
  controllers: [AdminRfqPdfController, AdminOrderQuotesController],
  providers: [AdminRfqPdfService, AdminOrderQuotesService],
  exports: [AdminOrderQuotesService],
})
export class AdminRfqPdfModule {}
