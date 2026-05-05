import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { SupplierContextService } from "src/supplier/supplier-context.service";
import { formatCurrency, slugify } from "src/supplier/utils";
import { CreateListingDto } from "./dto/create-listing.dto";
import { UpdateListingDto } from "./dto/update-listing.dto";

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supplierContext: SupplierContextService
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
    await this.findOne(id, user);
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

    return {
      id: product.id,
      name: product.name,
      unit: product.unit,
    };
  }
}