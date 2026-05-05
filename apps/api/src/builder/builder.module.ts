import { Module } from "@nestjs/common";
import { BuilderContextService } from "./builder-context.service";

@Module({
  providers: [BuilderContextService],
  exports: [BuilderContextService],
})
export class BuilderModule {}
