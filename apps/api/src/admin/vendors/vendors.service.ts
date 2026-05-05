import { Injectable, NotFoundException } from "@nestjs/common";
import { KycStatus, Role } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      where: { role: Role.SUPPLIER },
      include: {
        supplierProfile: true,
        kycDocuments: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      kycStatus: user.kycStatus,
      companyName: user.supplierProfile?.companyName || null,
      kycDocuments: user.kycDocuments.length,
      updatedAt: user.updatedAt,
    }));
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, role: Role.SUPPLIER },
      include: {
        supplierProfile: true,
        kycDocuments: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!user) throw new NotFoundException("Vendor not found");

    return user;
  }

  async updateKyc(id: string, status: KycStatus, actorId: string, note?: string) {
    const vendor = await this.prisma.user.findFirst({ where: { id, role: Role.SUPPLIER } });
    if (!vendor) throw new NotFoundException("Vendor not found");

    const updated = await this.prisma.user.update({
      where: { id },
      data: { kycStatus: status },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "VENDOR_KYC_UPDATED",
        entityType: "User",
        entityId: id,
        metadata: { status, note: note || null },
      },
    });

    return { id: updated.id, kycStatus: updated.kycStatus };
  }
}
