import { Module } from "@nestjs/common";
import { AdminContextService } from "./admin-context.service";

@Module({
  providers: [AdminContextService],
  exports: [AdminContextService],
})
export class AdminModule {}
