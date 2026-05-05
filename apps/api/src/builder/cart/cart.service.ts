import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { formatCurrency } from "src/supplier/utils";
import { BuilderContextService } from "src/builder/builder-context.service";
import { UpsertCartItemDto } from "./dto/upsert-cart-item.dto";

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builderContext: BuilderContextService
  ) {}

  async findAll(userCtx: any) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const items = await this.prisma.cartItem.findMany({
      where: { userId: user.id },
      include: { product: true },
      orderBy: { updatedAt: "desc" },
    });

    const subtotal = items.reduce((acc, item) => acc + Number(item.product.basePrice) * item.quantity, 0);

    return {
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        unit: item.product.unit,
        quantity: item.quantity,
        unitPrice: Number(item.product.basePrice),
        lineTotal: Number(item.product.basePrice) * item.quantity,
      })),
      summary: {
        itemCount: items.length,
        subtotal,
        subtotalLabel: formatCurrency(subtotal),
      },
    };
  }

  async upsert(userCtx: any, dto: UpsertCartItemDto) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || !product.isActive) {
      throw new NotFoundException("Product not found");
    }

    const item = await this.prisma.cartItem.upsert({
      where: { userId_productId: { userId: user.id, productId: dto.productId } },
      update: { quantity: dto.quantity },
      create: {
        userId: user.id,
        productId: dto.productId,
        quantity: dto.quantity,
      },
    });

    return { id: item.id, productId: item.productId, quantity: item.quantity };
  }

  async remove(userCtx: any, productId: string) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    await this.prisma.cartItem.deleteMany({ where: { userId: user.id, productId } });
    return { productId, removed: true };
  }
}
