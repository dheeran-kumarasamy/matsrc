import { Injectable, NotFoundException } from "@nestjs/common";
import { DisputeStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<
    Array<{
      id: string;
      orderId: string;
      userId: string;
      issueType: string;
      description: string;
      status: string;
      resolution: string | null;
      createdAt: Date;
      updatedAt: Date;
      user: { id: string; name: string | null; email: string | null };
      order: { id: string; status: string; totalAmount: number };
    }>
  > {
    const disputes = await this.prisma.dispute.findMany({
      include: {
        user: true,
        order: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    return disputes.map((dispute) => ({
      id: dispute.id,
      orderId: dispute.orderId,
      userId: dispute.userId,
      issueType: dispute.issueType,
      description: dispute.description,
      status: dispute.status,
      resolution: dispute.resolution,
      createdAt: dispute.createdAt,
      updatedAt: dispute.updatedAt,
      user: {
        id: dispute.user.id,
        name: dispute.user.name,
        email: dispute.user.email,
      },
      order: {
        id: dispute.order.id,
        status: dispute.order.status,
        totalAmount: Number(dispute.order.totalAmount),
      },
    }));
  }

  async update(id: string, status: DisputeStatus, actorId: string, resolution?: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException("Dispute not found");

    const updated = await this.prisma.dispute.update({
      where: { id },
      data: {
        status,
        resolution: resolution?.trim() || undefined,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "DISPUTE_UPDATED",
        entityType: "Dispute",
        entityId: id,
        metadata: { status, resolution: resolution || null },
      },
    });

    return { id: updated.id, status: updated.status };
  }
}
