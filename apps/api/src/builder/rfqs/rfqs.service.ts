import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { BuilderContextService } from "src/builder/builder-context.service";
import { CreateRfqDto } from "./dto/create-rfq.dto";

@Injectable()
export class BuilderRfqsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builderContext: BuilderContextService
  ) {}

  async findAll(userCtx: any) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const rfqs = await this.prisma.quickRequest.findMany({
      where: { userId: user.id },
      include: { quotes: { orderBy: { createdAt: "desc" }, take: 3 } },
      orderBy: { createdAt: "desc" },
    });

    return rfqs.map((rfq) => ({
      id: rfq.id,
      materialName: rfq.materialName,
      quantity: rfq.quantity,
      pincode: rfq.pincode,
      notes: rfq.notes,
      quotes: rfq.quotes.map((quote) => ({
        id: quote.id,
        supplierId: quote.supplierId,
        price: Number(quote.price),
        validUntil: quote.validUntil,
      })),
      createdAt: rfq.createdAt,
    }));
  }

  async create(userCtx: any, dto: CreateRfqDto) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const rfq = await this.prisma.quickRequest.create({
      data: {
        userId: user.id,
        materialName: dto.materialName.trim(),
        quantity: dto.quantity.trim(),
        pincode: dto.pincode.trim(),
        notes: dto.notes?.trim() || null,
      },
    });

    return {
      id: rfq.id,
      materialName: rfq.materialName,
      quantity: rfq.quantity,
      pincode: rfq.pincode,
    };
  }

  async findOne(
    userCtx: any,
    id: string
  ): Promise<{
    id: string;
    materialName: string;
    quantity: string;
    pincode: string;
    notes: string | null;
    quotes: Array<{
      id: string;
      supplierId: string;
      price: number;
      validUntil: Date | null;
      notes: string | null;
      createdAt: Date;
    }>;
    createdAt: Date;
  }> {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const rfq = await this.prisma.quickRequest.findFirst({
      where: { id, userId: user.id },
      include: { quotes: true },
    });

    if (!rfq) throw new NotFoundException("RFQ not found");

    return {
      id: rfq.id,
      materialName: rfq.materialName,
      quantity: rfq.quantity,
      pincode: rfq.pincode,
      notes: rfq.notes,
      quotes: rfq.quotes.map((quote) => ({
        id: quote.id,
        supplierId: quote.supplierId,
        price: Number(quote.price),
        validUntil: quote.validUntil,
        notes: quote.notes,
        createdAt: quote.createdAt,
      })),
      createdAt: rfq.createdAt,
    };
  }
}
