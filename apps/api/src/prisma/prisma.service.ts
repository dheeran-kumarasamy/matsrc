import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@matsrc/db";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}