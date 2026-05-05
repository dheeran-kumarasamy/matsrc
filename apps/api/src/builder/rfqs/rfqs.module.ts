import { Module } from "@nestjs/common";
import { BuilderModule } from "src/builder/builder.module";
import { BuilderRfqsController } from "./rfqs.controller";
import { BuilderRfqsService } from "./rfqs.service";

@Module({
  imports: [BuilderModule],
  controllers: [BuilderRfqsController],
  providers: [BuilderRfqsService],
})
export class BuilderRfqsModule {}
