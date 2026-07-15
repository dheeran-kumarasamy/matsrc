import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { SupplierContextService } from "src/supplier/supplier-context.service";
import { formatCurrency, slugify } from "src/supplier/utils";
import { CreateListingDto } from "./dto/create-listing.dto";
import { UpdateListingDto } from "./dto/update-listing.dto";
import { UpdateAggregationSettingsDto } from "./dto/update-aggregation-settings.dto";
import { WhatsAppAlertService } from "src/notifications/whatsapp-alerts/whatsapp-alert.service";

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supplierContext: SupplierContextService,
    private readonly whatsAppAlertService: WhatsAppAlertService
  ) {}

  async findAll(user: any) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);

    const listings = await this.prisma.product.findMany({
      where: { supplierId: supplierProfile.id },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
    });

    return listings.map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category.name,
      grade: product.grade ?? "NA",
      unit: product.unit,
      price: `${formatCurrency(product.basePrice.toString())} / ${product.unit}`,
      stock: `${product.stock} ${product.unit}`,
      active: product.isActive,
    }));
  }

  async findOne(id: string, user: any) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);

    const listing = await this.prisma.product.findFirst({
      where: { id, supplierId: supplierProfile.id },
      include: { category: true },
    });

    if (!listing) {
      throw new NotFoundException("Listing not found");
    }

    return {
      id: listing.id,
      title: listing.name,
      category: listing.category.name,
      grade: listing.grade ?? "",
      unit: listing.unit,
      stock: String(listing.stock),
      price: listing.basePrice.toString(),
      brand: listing.brand ?? "",
      description: listing.description ?? "",
    };
  }

  async create(dto: CreateListingDto, user: any): Promise<{ id: string; name: string; category: string; unit: string }> {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);
    const categoryName = dto.category.trim();
    const category = await this.prisma.category.upsert({
      where: { slug: slugify(categoryName) },
      update: { name: categoryName },
      create: { name: categoryName, slug: slugify(categoryName) },
    });

    const suffix = Math.random().toString(36).slice(2, 7);

    const product = await this.prisma.product.create({
      data: {
        supplierId: supplierProfile.id,
        categoryId: category.id,
        name: dto.title.trim(),
        slug: `${slugify(dto.title)}-${suffix}`,
        brand: dto.brand?.trim() || null,
        grade: dto.grade?.trim() || null,
        description: dto.description?.trim() || null,
        unit: dto.unit.trim().toUpperCase(),
        basePrice: Number(dto.price),
        stock: Number(dto.stock),
        images: [],
        isActive: true,
      },
    });

    return {
      id: product.id,
      name: product.name,
      category: category.name,
      unit: product.unit,
    };
  }

  async update(id: string, dto: UpdateListingDto, user: any): Promise<{ id: string; name: string; unit: string }> {
    const previous = await this.findOne(id, user);
    const categoryName = dto.category?.trim();

    let categoryId: string | undefined;
    if (categoryName) {
      const category = await this.prisma.category.upsert({
        where: { slug: slugify(categoryName) },
        update: { name: categoryName },
        create: { name: categoryName, slug: slugify(categoryName) },
      });
      categoryId = category.id;
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        categoryId,
        name: dto.title?.trim(),
        brand: dto.brand?.trim() || undefined,
        grade: dto.grade?.trim() || undefined,
        description: dto.description?.trim() || undefined,
        unit: dto.unit?.trim().toUpperCase(),
        basePrice: dto.price ? Number(dto.price) : undefined,
        stock: dto.stock ? Number(dto.stock) : undefined,
      },
    });

    // Watchlist price-alert hook (additive, non-blocking): only worth checking when the
    // price actually changed and dropped, avoiding unnecessary DB reads on every update.
    const previousPrice = Number(previous.price);
    const newPrice = Number(product.basePrice);
    if (dto.price && newPrice < previousPrice) {
      void this.checkWatchlistPriceHits(product.id, product.name, newPrice).catch((error) => {
        this.logger.warn(
          `Failed to process watchlist price-hit check for product ${product.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }

    return {
      id: product.id,
      name: product.name,
      unit: product.unit,
    };
  }

  /**
   * Watchlist price-alert (UF-09) — checks all builders watching this product whose
   * `targetPrice` has now been met/beaten by the new price, and sends each an
   * additive WhatsApp business alert (gated by `WHATSAPP_ENABLED` + per-user opt-in
   * inside `WhatsAppAlertService`). Marks `alertSent` so the same watchlist row isn't
   * re-alerted on every subsequent price update once its target has already been hit.
   *
   * Deliberately non-blocking/best-effort — never affects the underlying listing
   * price update this is triggered from.
   */
  private async checkWatchlistPriceHits(productId: string, productName: string, newPrice: number): Promise<void> {
    const hits = await this.prisma.watchlist.findMany({
      where: {
        productId,
        alertSent: false,
        targetPrice: { not: null, gte: newPrice },
      },
    });

    for (const hit of hits) {
      void this.whatsAppAlertService
        .sendWatchlistPriceHit({
          userId: hit.userId,
          productId,
          productName,
          currentPrice: newPrice.toString(),
          targetPrice: hit.targetPrice?.toString() ?? "",
        })
        .catch((error) => {
          this.logger.warn(
            `Failed to send WhatsApp watchlist price-hit alert for user ${hit.userId}/product ${productId}: ${error instanceof Error ? error.message : String(error)}`
          );
        });

      await this.prisma.watchlist
        .update({
          where: { id: hit.id },
          data: { alertSent: true },
        })
        .catch((error) => {
          this.logger.warn(
            `Failed to mark watchlist entry ${hit.id} as alerted: ${error instanceof Error ? error.message : String(error)}`
          );
        });
    }
  }

  /**
   * Updates a listing's Order Aggregation ("Group & Save") configuration. Enabling/
   * disabling aggregation here does NOT retroactively affect already-open
   * AggregationPool rows — the scheduler and pool-matching logic only ever reads live
   * pool state, not `product.aggregationEnabled`, so in-flight pools complete under
   * their original terms even if the supplier disables aggregation mid-window.
   */
  async updateAggregationSettings(
    id: string,
    dto: UpdateAggregationSettingsDto,
    user: any
  ): Promise<{
    id: string;
    aggregationEnabled: boolean;
    aggregationPriceTiers: unknown;
    aggregationWindowDays: number | null;
    aggregationZoneRules: unknown;
  }> {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);

    const listing = await this.prisma.product.findFirst({
      where: { id, supplierId: supplierProfile.id },
    });

    if (!listing) {
      throw new NotFoundException("Listing not found");
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        aggregationEnabled: dto.aggregationEnabled,
        aggregationPriceTiers: dto.priceTiers ? (dto.priceTiers as any) : undefined,
        aggregationWindowDays: dto.defaultWindowDays,
        aggregationZoneRules: dto.zoneRules !== undefined ? (dto.zoneRules as any) : undefined,
      },
    });

    return {
      id: product.id,
      aggregationEnabled: product.aggregationEnabled,
      aggregationPriceTiers: product.aggregationPriceTiers,
      aggregationWindowDays: product.aggregationWindowDays,
      aggregationZoneRules: product.aggregationZoneRules,
    };
  }
}
