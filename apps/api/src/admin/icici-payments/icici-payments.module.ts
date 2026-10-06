import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { IciciPaymentsController } from "./icici-payments.controller";
import { IciciPaymentsService } from "./icici-payments.service";

@Module({
  imports: [AdminModule],
  controllers: [IciciPaymentsController],
  providers: [IciciPaymentsService],
})
export class IciciPaymentsModule {}
