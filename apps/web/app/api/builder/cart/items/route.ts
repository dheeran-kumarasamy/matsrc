import { NextResponse } from "next/server";
import {
  prisma,
  resolveUnitPrice,
  formatCurrency,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";

const SUPPLIER_APP_URL = process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";

type SupplierListing = {
  id: string;
  name: string;
  category: string;
  grade: string;
  unit: string;
  price: string;
  stock: string;
  active: boolean;
};

function parseNumberLabel(value: string) {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseQuantityLabel(value: string) {
  const numeric = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

async function fetchSupplierListing(productId: string): Promise<SupplierListing | null> {
  try {
    const response = await fetch(`${SUPPLIER_APP_URL}/api/public/listings`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return null;
    }

    const listings = (await response.json()) as SupplierListing[];
    return listings.find((listing) => listing.id === productId) ?? null;
  } catch {
    return null;
  }
}

async function ensureMarketplaceProduct(listing: SupplierListing) {
  const supplierUser = await prisma.user.upsert({
    where: { email: "marketplace.supplier@buildmart.local" },
    update: { role: "SUPPLIER", name: "Verified Supplier" },
    create: {
      email: "marketplace.supplier@buildmart.local",
      name: "Verified Supplier",
      role: "SUPPLIER",
    },
  });

  const supplierProfile = await prisma.supplierProfile.upsert({
    where: { userId: supplierUser.id },
    update: { companyName: "Verified Supplier" },
    create: { userId: supplierUser.id, companyName: "Verified Supplier" },
  });

  const category = await prisma.category.upsert({
    where: { slug: listing.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") },
    update: { name: listing.category },
    create: {
      name: listing.category,
      slug: listing.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    },
  });

  return prisma.product.upsert({
    where: { id: listing.id },
    update: {
      name: listing.name,
      categoryId: category.id,
      grade: listing.grade,
      unit: listing.unit,
      basePrice: parseNumberLabel(listing.price),
      stock: parseQuantityLabel(listing.stock),
      maxServiceableQty: parseQuantityLabel(listing.stock) || undefined,
      isActive: listing.active,
      supplierId: supplierProfile.id,
      slug: `marketplace-${listing.id}`,
    },
    create: {
      id: listing.id,
      supplierId: supplierProfile.id,
      categoryId: category.id,
      name: listing.name,
      slug: `marketplace-${listing.id}`,
      grade: listing.grade,
      unit: listing.unit,
      basePrice: parseNumberLabel(listing.price),
      stock: parseQuantityLabel(listing.stock),
      maxServiceableQty: parseQuantityLabel(listing.stock) || null,
      images: [],
      isActive: listing.active,
    },
  });
}

export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const items = await prisma.cartItem.findMany({
      where: { userId: user.id },
      include: {
        product: {
          select: {
            name: true,
            unit: true,
            supplierId: true,
            basePrice: true,
            supplier: { select: { companyName: true } },
            pricingTiers: {
              select: { minQty: true, maxQty: true, tierPrice: true },
              orderBy: { minQty: "asc" },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const subtotal = items.reduce(
      (acc, item) =>
        acc + resolveUnitPrice(item.product, item.quantity) * item.quantity,
      0
    );

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        unit: item.product.unit,
        supplierId: item.product.supplierId,
        supplierName: item.product.supplier.companyName,
        quantity: item.quantity,
        unitPrice: resolveUnitPrice(item.product, item.quantity),
        lineTotal: resolveUnitPrice(item.product, item.quantity) * item.quantity,
      })),
      summary: {
        itemCount: items.length,
        subtotal,
        subtotalLabel: formatCurrency(subtotal),
      },
    });
  } catch (error) {
    console.error("Cart items GET error:", error);
    return NextResponse.json({ error: "Failed to fetch cart" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));
    const productId = typeof body.productId === "string" ? body.productId : "";
    const quantity = Number(body.quantity);

    if (!productId || !Number.isInteger(quantity) || quantity < 1) {
      return NextResponse.json(
        { error: "Valid productId and quantity are required" },
        { status: 400 }
      );
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true },
    });
    let resolvedProduct = product;

    if (!resolvedProduct || !resolvedProduct.isActive) {
      const listing = await fetchSupplierListing(productId);
      if (!listing || !listing.active) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }

      resolvedProduct = await ensureMarketplaceProduct(listing);
    }

    if (!resolvedProduct.isActive) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const item = await prisma.cartItem.upsert({
      where: { userId_productId: { userId: user.id, productId } },
      update: { quantity },
      create: { userId: user.id, productId, quantity },
    });

    return NextResponse.json({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
    });
  } catch (error) {
    console.error("Cart items POST error:", error);
    return NextResponse.json(
      { error: "Failed to update cart" },
      { status: 500 }
    );
  }
}
