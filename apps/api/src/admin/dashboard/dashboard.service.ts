import { Injectable } from "@nestjs/common";
import { DisputeStatus, KycStatus, PurchaseOrderStatus, Role } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const [pendingVendors, pendingKyc, openDisputes, totalOrders, issuedPurchaseOrders] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.SUPPLIER, kycStatus: KycStatus.PENDING } }),
      this.prisma.kycDocument.count({ where: { verified: false } }),
      this.prisma.dispute.count({ where: { status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW, DisputeStatus.ESCALATED] } } }),
      this.prisma.order.count(),
      this.prisma.purchaseOrder.count({
        where: {
          status: {
            in: [PurchaseOrderStatus.ISSUED, PurchaseOrderStatus.ACKNOWLEDGED, PurchaseOrderStatus.FULFILLED],
          },
        },
      }),
    ]);

    return { pendingVendors, pendingKyc, openDisputes, totalOrders, issuedPurchaseOrders };
  }

}
