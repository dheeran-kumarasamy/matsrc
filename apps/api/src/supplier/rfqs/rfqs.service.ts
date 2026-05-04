import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { SupplierContextService } from "src/supplier/supplier-context.service";
import { formatDate } from "src/supplier/utils";
import { CreateQuoteDto } from "./dto/create-quote.dto";

@Injectable()
export class RfqsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supplierContext: SupplierContextService
  ) {}

  async findAll() {
    const { supplierProfile } = await this.supplierContext.getCurrentSupplier();

    const rfqs = await this.prisma.quickRequest.findMany({
      include: {
        quotes: {
          where: { supplierId: supplierProfile.id },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return rfqs.map((rfq) => ({
      id: rfq.id,
      material: rfq.materialName,
      quantity: rfq.quantity,
      pincode: rfq.pincode,
      dueBy: formatDate(new Date(rfq.createdAt.getTime() + 24 * 60 * 60 * 1000)),
      latestQuote: rfq.quotes[0]
        ? {
            price: rfq.quotes[0].price.toString(),
            validUntil: rfq.quotes[0].validUntil?.toISOString() ?? null,
          }
        : null,
    }));
  }

  async createQuote(rfqId: string, dto: CreateQuoteDto): Promise<{ id: string; rfqId: string; price: string }> {
    const { supplierProfile } = await this.supplierContext.getCurrentSupplier();
    const rfq = await this.prisma.quickRequest.findUnique({ where: { id: rfqId } });

    if (!rfq) {
      throw new NotFoundException("RFQ not found");
    }

    const quote = await this.prisma.quote.create({
      data: {
        supplierId: supplierProfile.id,
        rfqId,
        price: Number(dto.price),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        notes: dto.notes?.trim() || null,
      },
    });

    return {
      id: quote.id,
      rfqId: quote.rfqId ?? rfqId,
      price: quote.price.toString(),
    };
  }
}