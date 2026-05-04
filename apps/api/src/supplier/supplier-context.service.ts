import { Injectable } from "@nestjs/common";
import { Role } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

const DEV_SUPPLIER_EMAIL = "supplier.demo@buildmart.local";

@Injectable()
export class SupplierContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentSupplier() {
    const user = await this.prisma.user.upsert({
      where: { email: DEV_SUPPLIER_EMAIL },
      update: { role: Role.SUPPLIER, name: "Demo Supplier" },
      create: {
        email: DEV_SUPPLIER_EMAIL,
        name: "Demo Supplier",
        phone: "+919000011111",
        role: Role.SUPPLIER,
        whatsappNumber: "+919000011111",
        supplierProfile: {
          create: {
            companyName: "BuildMart Demo Supplies",
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
          companyName: user.name ?? "BuildMart Demo Supplies",
        },
      });

      return { user, supplierProfile };
    }

    return { user, supplierProfile: user.supplierProfile };
  }
}