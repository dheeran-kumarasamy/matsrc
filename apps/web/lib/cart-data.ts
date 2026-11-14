import { createHash } from "crypto";
import {
  prisma,
  resolveUnitPrice,
  formatCurrency,
} from "@/lib/builder-db";
import { getSupplierDisplayName } from "@/lib/supplier-display";
import {
  resolveLowestPriceForQuantity,
  type ResolutionCandidate,
} from "@/lib/resolution";
import { resolveMarkupForProductsBatch } from "@matsrc/db";

export type CartItemData = {
  id: string;
  productId: string;
  name: string;
  unit: string;
  image: string | null;
  supplierId: string;
  supplierName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  aggregationEnabled?: boolean;
  aggregationPriceTiers?: any;
  aggregationWindowDays?: number | null;
};

export type CartSummaryData = {
  itemCount: number;
  subtotal: number;
  subtotalLabel: string;
};

export type CartPayload = {
  items: CartItemData[];
  summary: CartSummaryData;
};

export interface CartFingerprintPayload {
  productId: string;
  quantity: number;
  mode: "increment" | "set";
  cartItemId: string | null;
}

/**
 * Computes a deterministic SHA-256 fingerprint of every request field that can
 * materially alter the cart mutation. Keys are sorted for canonical stability.
 */
export function computeRequestFingerprint(params: {
  productId: string;
  quantity: number;
  mode: "increment" | "set";
  cartItemId?: string | null;
}): string {
  const normalized: CartFingerprintPayload = {
    productId: params.productId.trim(),
    quantity: Math.floor(params.quantity),
    mode: params.mode,
    cartItemId: params.cartItemId ? params.cartItemId.trim() : null,
  };
  return createHash("sha256")
    .update(JSON.stringify(normalized, Object.keys(normalized).sort()))
    .digest("hex");
}

export function productToResolutionCandidate(product: {
  id: string;
  supplierId: string;
  basePrice: any;
  stock: number;
  maxServiceableQty?: number | null;
  isActive: boolean;
  pricingTiers?: Array<{ minQty: number; maxQty: number; tierPrice: any }>;
}): ResolutionCandidate {
  const fallbackMaxQty = product.maxServiceableQty ?? product.stock;
  const pricingTiers =
    Array.isArray(product.pricingTiers) && product.pricingTiers.length > 0
      ? product.pricingTiers.map((tier) => ({
          minQty: Number(tier.minQty),
          maxQty: Number(tier.maxQty),
          tierPrice: Number(tier.tierPrice),
        }))
      : [
          {
            minQty: 1,
            maxQty: fallbackMaxQty || 1,
            tierPrice: Number(product.basePrice),
          },
        ];

  return {
    listingId: product.id,
    supplierId: product.supplierId,
    basePrice: Number(product.basePrice),
    stock: Number(product.stock),
    maxServiceableQty: Number(fallbackMaxQty),
    pricingTiers,
    isActive: product.isActive,
  };
}

/**
 * Targeted product lookup for cart additions. Retrieves the requested product
 * and any active sibling listings in the same canonical group directly from
 * the database, avoiding the full-catalogue HTTP request.
 */
export async function resolveProductGroupForCart(productId: string, quantity: number, dbClient?: any) {
  const client = dbClient || prisma;
  const product = await client.product.findFirst({
    where: {
      OR: [{ id: productId }, { slug: productId }],
      isActive: true,
    },
    include: {
      category: true,
      supplier: { select: { companyName: true } },
      pricingTiers: { orderBy: { minQty: "asc" } },
    },
  });

  if (!product) {
    return null;
  }

  let groupProducts: typeof product[] = [];
  if (product.canonicalProductId && product.canonicalProductId.trim() !== "") {
    const foundGroup = await client.product.findMany({
      where: {
        canonicalProductId: product.canonicalProductId,
        isActive: true,
      },
      include: {
        category: true,
        supplier: { select: { companyName: true } },
        pricingTiers: { orderBy: { minQty: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    });
    groupProducts = Array.isArray(foundGroup) ? foundGroup : [];

    if (!groupProducts.some((p) => p.id === product.id)) {
      groupProducts.unshift(product);
    }
  } else {
    groupProducts = [product];
  }

  const candidates = groupProducts.map(productToResolutionCandidate);
  const resolution = resolveLowestPriceForQuantity(candidates, quantity);

  return { product, candidates, resolution };
}

/**
 * Returns the full, authoritative cart representation for a user with
 * admin-configured markups applied via batched database lookup.
 * Shared between GET /api/builder/cart and POST /api/builder/cart/items.
 */
export async function getCartForUser(userId: string, dbClient?: any): Promise<CartPayload> {
  const client = dbClient || prisma;
  const rawItems = await client.cartItem.findMany({
    where: { userId },
    include: {
      product: {
        select: {
          name: true,
          unit: true,
          supplierId: true,
          categoryId: true,
          basePrice: true,
          images: true,
          supplier: { select: { companyName: true } },
          pricingTiers: {
            select: { minQty: true, maxQty: true, tierPrice: true },
            orderBy: { minQty: "asc" },
          },
          aggregationEnabled: true,
          aggregationPriceTiers: true,
          aggregationWindowDays: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  const items = rawItems ?? [];

  const batchParams = items.map((item: any) => {
    const supplierUnitPrice =
      item.resolvedUnitPrice != null
        ? Number(item.resolvedUnitPrice)
        : resolveUnitPrice(item.product, item.quantity);

    return {
      productId: item.productId,
      categoryId: item.product.categoryId,
      supplierUnitPrice,
    };
  });

  const markups = await resolveMarkupForProductsBatch(client as any, batchParams).catch(
    () => items.map(() => null)
  );

  const itemsWithBuyerPrice = items.map((item: any, idx: number) => {
    const supplierUnitPrice = batchParams[idx].supplierUnitPrice;
    const markup = markups[idx];
    const unitPrice = markup ? markup.buyerUnitPrice : supplierUnitPrice;
    return { item, unitPrice };
  });

  const subtotal = itemsWithBuyerPrice.reduce(
    (acc: number, { unitPrice, item }: { unitPrice: number; item: any }) => acc + unitPrice * item.quantity,
    0
  );

  return {
    items: itemsWithBuyerPrice.map(({ item, unitPrice }: { item: any; unitPrice: number }) => ({
      id: item.id,
      productId: item.productId,
      name: item.product.name,
      unit: item.product.unit,
      image: item.product.images?.[0] ?? null,
      supplierId: item.resolvedSupplierId ?? item.product.supplierId,
      supplierName: getSupplierDisplayName(
        item.product.supplier.companyName,
        item.resolvedSupplierId ?? item.product.supplierId
      ),
      quantity: item.quantity,
      unitPrice,
      lineTotal: unitPrice * item.quantity,
      aggregationEnabled: item.product.aggregationEnabled,
      aggregationPriceTiers: item.product.aggregationPriceTiers,
      aggregationWindowDays: item.product.aggregationWindowDays,
    })),
    summary: {
      itemCount: items.length,
      subtotal,
      subtotalLabel: formatCurrency(subtotal),
    },
  };
}

/**
 * Retention and Cleanup Policy for CartIdempotency:
 * - Records are retained for a 24-hour retry window (expiresAt = createdAt + 24h).
 * - A 7-day post-expiry retention grace period is enforced before physical deletion,
 *   meaning records become eligible for deletion approximately 8 days (~192 hours) after creation.
 * - Records within the supported retry and grace windows are never deleted.
 * - Handles records where expiresAt IS NULL safely via creation-time retention (createdAt < cutoff - 24h).
 * - Supports bounded batches to prevent excessive database transaction spikes.
 */
export async function cleanupExpiredCartIdempotencies(
  cutoff = new Date(),
  dbClient?: any,
  options?: { batchSize?: number }
): Promise<number> {
  const client = dbClient || prisma;
  const nullCreatedAtCutoff = new Date(cutoff.getTime() - 24 * 60 * 60 * 1000);
  const whereClause = {
    OR: [
      { expiresAt: { lt: cutoff } },
      { expiresAt: null, createdAt: { lt: nullCreatedAtCutoff } },
    ],
  };

  const batchSize = options?.batchSize;
  if (batchSize && typeof client.cartIdempotency.findMany === "function") {
    let totalDeleted = 0;
    while (true) {
      const records = await client.cartIdempotency.findMany({
        where: whereClause,
        select: { id: true },
        take: batchSize,
      });

      if (!records || records.length === 0) {
        break;
      }

      const ids = records.map((r: { id: string }) => r.id);
      const res = await client.cartIdempotency.deleteMany({
        where: { id: { in: ids } },
      });

      totalDeleted += res?.count ?? 0;
      if (records.length < batchSize) {
        break;
      }
    }
    return totalDeleted;
  }

  const result = await client.cartIdempotency.deleteMany({
    where: whereClause,
  });
  return result?.count ?? 0;
}


