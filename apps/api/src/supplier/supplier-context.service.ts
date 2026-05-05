import { Injectable } from "@nestjs/common";
import { Role } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class SupplierContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateSupplier(userId: string, email: string, name?: string) {
    const user = await this.prisma.user.upsert({
      where: { email },
      update: { 
        role: Role.SUPPLIER, 
        name: name || email.split('@')[0] 
      },
      create: {
        id: userId,
        email,
        name: name || email.split('@')[0],
        role: Role.SUPPLIER,
        supplierProfile: {
          create: {
            companyName: name || email.split('@')[0],
          },
        },
      },
      include: {
        supplierProfile: true,
      },
    });

    if (!user.supplierProfile) {
      const supplierProfile = await this.prisma.supplierProfile.create({
        data: {
          userId: user.id,
          companyName: user.name ?? email.split('@')[0],
        },
      });

      return { user, supplierProfile };
    }

    return { user, supplierProfile: user.supplierProfile };
  }
}