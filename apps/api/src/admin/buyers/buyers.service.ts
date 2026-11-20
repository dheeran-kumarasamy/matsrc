import { Injectable, NotFoundException } from "@nestjs/common";
import { Role } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class BuyersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const buyers = await this.prisma.user.findMany({
      where: { role: Role.BUILDER },
      select: {
        id: true,
        name: true,
        legalName: true,
        tradeName: true,
        email: true,
        phone: true,
        gstin: true,
        billingAddress: true,
        billingCity: true,
        billingState: true,
        billingPincode: true,
        paymentDueDays: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return buyers;
  }

  async updateCreditTerms(id: string, paymentDueDays: number) {
    const buyer = await this.prisma.user.findFirst({
      where: { id, role: Role.BUILDER },
    });

    if (!buyer) {
      throw new NotFoundException("Buyer not found");
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { paymentDueDays: Math.max(0, paymentDueDays) },
      select: {
        id: true,
        name: true,
        paymentDueDays: true,
      },
    });

    return updated;
  }
}

