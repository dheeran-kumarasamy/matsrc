import { Module } from "@nestjs/common";
import { SupplierModule } from "src/supplier/supplier.module";
import { RfqsController } from "./rfqs.controller";
import { RfqsService } from "./rfqs.service";

@Module({
  imports: [SupplierModule],
  controllers: [RfqsController],
  providers: [RfqsService],
})
export class RfqsModule {}