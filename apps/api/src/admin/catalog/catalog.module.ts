import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { CatalogController } from "./catalog.controller";
import { PublicCatalogController } from "./public-catalog.controller";
import { CatalogService } from "./catalog.service";

@Module({
  imports: [AdminModule],
  controllers: [CatalogController, PublicCatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
