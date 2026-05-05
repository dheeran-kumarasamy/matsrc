import { Module } from "@nestjs/common";
import { AdminModule } from "src/admin/admin.module";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";

@Module({
  imports: [AdminModule],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
