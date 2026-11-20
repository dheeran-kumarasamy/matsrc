import { Module } from "@nestjs/common";
import { BuyersController } from "./buyers.controller";
import { BuyersService } from "./buyers.service";

@Module({
  controllers: [BuyersController],
  providers: [BuyersService],
  exports: [BuyersService],
})
export class BuyersModule {}

