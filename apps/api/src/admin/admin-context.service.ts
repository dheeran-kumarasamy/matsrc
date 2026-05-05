import { Injectable } from "@nestjs/common";
import { Role } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class AdminContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateAdmin(userId: string, email: string, name?: string) {
    const displayName = name?.trim() || email.split("@")[0];

    return this.prisma.user.upsert({
      where: { email },
      update: { role: Role.ADMIN, name: displayName },
      create: {
        id: userId,
        email,
        name: displayName,
        role: Role.ADMIN,
      },
    });
  }
}
