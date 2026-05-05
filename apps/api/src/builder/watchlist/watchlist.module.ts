import { Module } from "@nestjs/common";
import { BuilderModule } from "src/builder/builder.module";
import { WatchlistController } from "./watchlist.controller";
import { WatchlistService } from "./watchlist.service";

@Module({
  imports: [BuilderModule],
  controllers: [WatchlistController],
  providers: [WatchlistService],
})
export class WatchlistModule {}
