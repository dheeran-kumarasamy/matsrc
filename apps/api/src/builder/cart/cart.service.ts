import { Injectable, NotFoundException } from "@nestjs/common";
import { resolveMarkupForProduct } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { formatCurrency } from "src/supplier/utils";
import { BuilderContextService } from "src/builder/builder-context.service";
import { UpsertCartItemDto } from "./dto/upsert-cart-item.dto";

function resolveUnitPrice(product: any, quantity: number) {
  const tiers = Array.isArray(product.pricingTiers) ? product.pricingTiers : [];
  const matchedTier = tiers.find((tier: any) => quantity >= tier.minQty && quantity <= tier.maxQty);
  return Number(matchedTier?.tierPrice ?? product.basePrice);
}

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
      include: {
        product: {
          include: {
            supplier: true,
            pricingTiers: { orderBy: { minQty: "asc" } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Admin-Configurable Product Markup: the cart is a buyer-facing preview
    // of checkout, so it must show the MARKED-UP price — see the identical
    // fix in apps/web/app/api/builder/cart/route.ts (the actual production
    // cart read path; this NestJS service is this app's own builder cart
    // module). Missing/disabled configuration fails safe to 0% markup.
    const itemsWithBuyerPrice = await Promise.all(
      items.map(async (item) => {
        const supplierUnitPrice = resolveUnitPrice(item.product, item.quantity);
        const markup = await resolveMarkupForProduct(this.prisma as any, {
          productId: item.productId,
          categoryId: item.product.categoryId,
          supplierUnitPrice,
        }).catch(() => null);
        return { item, unitPrice: markup ? markup.buyerUnitPrice : supplierUnitPrice };
      })
    );

    const subtotal = itemsWithBuyerPrice.reduce((acc, { unitPrice, item }) => acc + unitPrice * item.quantity, 0);

    return {
      items: itemsWithBuyerPrice.map(({ item, unitPrice }) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        unit: item.product.unit,
        supplierId: item.product.supplierId,
        supplierName: item.product.supplier.companyName,
        quantity: item.quantity,
        unitPrice,
        lineTotal: unitPrice * item.quantity,
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
