import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { VendorsController } from "./vendors.controller";
import { VendorsService } from "./vendors.service";

@Module({
  imports: [AdminModule],
  controllers: [VendorsController],
  providers: [VendorsService],
})
export class VendorsModule {}
