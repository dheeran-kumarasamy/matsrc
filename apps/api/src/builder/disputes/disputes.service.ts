import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DisputeStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { BuilderContextService } from "src/builder/builder-context.service";
import { CreateDisputeDto } from "./dto/create-dispute.dto";

@Injectable()
export class BuilderDisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builderContext: BuilderContextService
  ) {}

  async findAll(userCtx: any) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const disputes = await this.prisma.dispute.findMany({
      where: { userId: user.id },
      include: { order: true },
      orderBy: { createdAt: "desc" },
    });

    return disputes.map((d) => ({
      id: d.id,
      orderId: d.orderId,
      issueType: d.issueType,
      description: d.description,
      status: d.status,
      resolution: d.resolution,
      evidenceUrls: d.evidenceUrls,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      escalateAt: d.escalateAt,
      order: { id: d.order.id, status: d.order.status, total: Number(d.order.totalAmount) },
    }));
  }

  async findOne(userCtx: any, id: string) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const dispute = await this.prisma.dispute.findFirst({
      where: { id, userId: user.id },
      include: { order: { include: { items: { include: { product: true } } } } },
    });

    if (!dispute) throw new NotFoundException("Dispute not found");

    return {
      id: dispute.id,
      orderId: dispute.orderId,
      issueType: dispute.issueType,
      description: dispute.description,
      status: dispute.status,
      resolution: dispute.resolution,
      evidenceUrls: dispute.evidenceUrls,
      createdAt: dispute.createdAt,
      updatedAt: dispute.updatedAt,
      escalateAt: dispute.escalateAt,
      order: {
        id: dispute.order.id,
        status: dispute.order.status,
        total: Number(dispute.order.totalAmount),
        items: dispute.order.items.map((i) => ({
          name: i.product.name,
          quantity: i.quantity,
          unit: i.product.unit,
        })),
      },
    };
  }

  async create(userCtx: any, dto: CreateDisputeDto) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    // Ensure the order belongs to this builder
    const order = await this.prisma.order.findFirst({ where: { id: dto.orderId, userId: user.id } });
    if (!order) throw new NotFoundException("Order not found");

    // Prevent duplicate open disputes per order
    const existing = await this.prisma.dispute.findFirst({
      where: { orderId: dto.orderId, status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] } },
    });
    if (existing) throw new BadRequestException("An open dispute already exists for this order");

    const escalateAt = new Date();
    escalateAt.setHours(escalateAt.getHours() + 72);

    const dispute = await this.prisma.dispute.create({
      data: {
        orderId: dto.orderId,
        userId: user.id,
        issueType: dto.issueType,
        description: dto.description,
        evidenceUrls: dto.evidenceUrls ?? [],
        status: DisputeStatus.OPEN,
        escalateAt,
      },
    });

    return {
      id: dispute.id,
      orderId: dispute.orderId,
      status: dispute.status,
      escalateAt: dispute.escalateAt,
    };
  }
}
