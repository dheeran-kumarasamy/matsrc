import { Module } from "@nestjs/common";
import { AdminRfqPdfController } from "./rfq-pdf.controller";
import { AdminRfqPdfService } from "./rfq-pdf.service";

@Module({
  controllers: [AdminRfqPdfController],
  providers: [AdminRfqPdfService],
})
export class AdminRfqPdfModule {}
