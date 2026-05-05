import { Module } from "@nestjs/common";
import { BuilderModule } from "src/builder/builder.module";
import { CreditController } from "./credit.controller";
import { CreditService } from "./credit.service";

@Module({
  imports: [BuilderModule],
  controllers: [CreditController],
  providers: [CreditService],
})
export class CreditModule {}
