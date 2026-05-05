import { Injectable } from "@nestjs/common";
import { DisputeStatus, KycStatus, Role } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const [pendingVendors, pendingKyc, openDisputes, totalOrders] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.SUPPLIER, kycStatus: KycStatus.PENDING } }),
      this.prisma.kycDocument.count({ where: { verified: false } }),
      this.prisma.dispute.count({ where: { status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW, DisputeStatus.ESCALATED] } } }),
      this.prisma.order.count(),
    ]);

    return { pendingVendors, pendingKyc, openDisputes, totalOrders };
  }
}
