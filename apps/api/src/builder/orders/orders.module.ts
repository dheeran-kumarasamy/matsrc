import { Module } from "@nestjs/common";
import { BuilderModule } from "src/builder/builder.module";
import { BuilderOrdersController } from "./orders.controller";
import { BuilderOrdersService } from "./orders.service";

@Module({
  imports: [BuilderModule],
  controllers: [BuilderOrdersController],
  providers: [BuilderOrdersService],
})
export class BuilderOrdersModule {}
