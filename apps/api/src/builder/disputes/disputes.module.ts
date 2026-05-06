import { Module } from "@nestjs/common";
import { BuilderModule } from "src/builder/builder.module";
import { BuilderDisputesController } from "./disputes.controller";
import { BuilderDisputesService } from "./disputes.service";

@Module({
  imports: [BuilderModule],
  controllers: [BuilderDisputesController],
  providers: [BuilderDisputesService],
})
export class BuilderDisputesModule {}
