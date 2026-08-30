import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { BuilderContextService } from "src/builder/builder-context.service";
import { AddWatchlistItemDto } from "./dto/add-watchlist-item.dto";

@Injectable()
export class WatchlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builderContext: BuilderContextService
  ) {}

  async findAll(userCtx: any) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const items = await this.prisma.watchlist.findMany({
      where: { userId: user.id },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });

    return items.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.product.name,
      unit: item.product.unit,
      basePrice: Number(item.product.basePrice),
      targetPrice: item.targetPrice ? Number(item.targetPrice) : null,
    }));
  }

  async add(userCtx: any, dto: AddWatchlistItemDto) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException("Product not found");

    const item = await this.prisma.watchlist.upsert({
      where: { userId_productId: { userId: user.id, productId: dto.productId } },
      update: { targetPrice: dto.targetPrice ? Number(dto.targetPrice) : null },
      create: {
        userId: user.id,
        productId: dto.productId,
        targetPrice: dto.targetPrice ? Number(dto.targetPrice) : null,
      },
    });

    return { id: item.id, productId: item.productId };
  }

  async updateTargetPrice(userCtx: any, productId: string, targetPriceRaw: number | string) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    const targetPrice = Number(targetPriceRaw);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      throw new BadRequestException("Target price must be a numeric value greater than zero");
    }

    const existing = await this.prisma.watchlist.findUnique({
      where: { userId_productId: { userId: user.id, productId } },
    });

    if (!existing) throw new NotFoundException("Watchlist item not found");

    const item = await this.prisma.watchlist.update({
      where: { id: existing.id },
      data: { targetPrice },
      include: { product: true },
    });

    return {
      id: item.id,
      productId: item.productId,
      name: item.product.name,
      unit: item.product.unit,
      basePrice: Number(item.product.basePrice),
      targetPrice: Number(item.targetPrice),
    };
  }

  async remove(userCtx: any, productId: string) {
    const { user } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    await this.prisma.watchlist.deleteMany({ where: { userId: user.id, productId } });
    return { productId, removed: true };
  }
}

