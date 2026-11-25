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

let cartSchemaEnsured = false;
let cartSchemaEnsuringPromise: Promise<void> | null = null;

/**
 * Self-heals cart and catalogue schema on unmigrated databases, ensuring that
 * missing columns (e.g. isOrderable, resolvedUnitPrice) or missing tables
 * (e.g. CartIdempotency, PricingTier) do not crash cart operations with P2021/P2022.
 */
export async function ensureCartSchema(client?: any): Promise<void> {
  if (cartSchemaEnsured) return;
  if (cartSchemaEnsuringPromise) return cartSchemaEnsuringPromise;

  const db = client || prisma;
  if (!db || typeof db.$executeRawUnsafe !== "function") return;

  cartSchemaEnsuringPromise = (async () => {
    try {
      await db.$executeRawUnsafe('ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "maxServiceableQty" DOUBLE PRECISION;');
      await db.$executeRawUnsafe('ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isOrderable" BOOLEAN NOT NULL DEFAULT true;');
      await db.$executeRawUnsafe('ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "isOrderable" BOOLEAN NOT NULL DEFAULT true;');
      await db.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS "PricingTier" ("id" TEXT PRIMARY KEY, "productId" TEXT NOT NULL, "minQty" DOUBLE PRECISION NOT NULL, "maxQty" DOUBLE PRECISION NOT NULL, "tierPrice" DECIMAL(12,2) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);'
      );
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PricingTier_productId_idx" ON "PricingTier"("productId");');
      await db.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "OrderSplittingConfig" (
          "id" TEXT NOT NULL DEFAULT 'global',
          "allowMultiSupplierSplitting" BOOLEAN NOT NULL DEFAULT false,
          "splitOnlyAcrossCategories" BOOLEAN NOT NULL DEFAULT true,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedBy" TEXT,
          CONSTRAINT "OrderSplittingConfig_pkey" PRIMARY KEY ("id")
        );
      `);
      await db.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CartIdempotency" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "key" TEXT NOT NULL,
          "requestFingerprint" TEXT NOT NULL,
          "responseStatus" INTEGER NOT NULL DEFAULT 200,
          "responsePayload" JSONB,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          "expiresAt" TIMESTAMP(3),
          CONSTRAINT "CartIdempotency_pkey" PRIMARY KEY ("id")
        );
      `);
      await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "CartIdempotency_userId_key_key" ON "CartIdempotency"("userId", "key");');
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "CartIdempotency_userId_idx" ON "CartIdempotency"("userId");');
      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "CartIdempotency_expiresAt_idx" ON "CartIdempotency"("expiresAt");');
      await db.$executeRawUnsafe('ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "resolvedListingId" TEXT;');
      await db.$executeRawUnsafe('ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "resolvedSupplierId" TEXT;');
      await db.$executeRawUnsafe('ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "resolvedTierMinQty" DOUBLE PRECISION;');
      await db.$executeRawUnsafe('ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "resolvedTierMaxQty" DOUBLE PRECISION;');
      await db.$executeRawUnsafe('ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "resolvedUnitPrice" DECIMAL(12,2);');
      await db.$executeRawUnsafe('ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);');
      await db.$executeRawUnsafe('ALTER TABLE "CartItem" ALTER COLUMN "quantity" TYPE DOUBLE PRECISION;');
      cartSchemaEnsured = true;
    } catch (err) {
      console.warn("ensureCartSchema warning:", err);
    } finally {
      cartSchemaEnsuringPromise = null;
    }
  })();

  return cartSchemaEnsuringPromise;
}

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
  await ensureCartSchema(client);

  const productWhere = {
    OR: [
      { id: productId },
      { slug: productId },
      { canonicalProductId: productId },
    ],
    isActive: true,
  };

  let product: any = null;
  try {
    product = await client.product.findFirst({
      where: productWhere,
      include: {
        category: true,
        supplier: { select: { companyName: true } },
        pricingTiers: { orderBy: { minQty: "asc" } },
      },
    });
  } catch (err: any) {
    if (err?.code === "P2021" || err?.code === "P2022") {
      await ensureCartSchema(client);
      try {
        product = await client.product.findFirst({
          where: productWhere,
          include: {
            category: true,
            supplier: { select: { companyName: true } },
          },
        });
      } catch (fallbackErr) {
        console.error("resolveProductGroupForCart fallback failed:", fallbackErr);
        throw err;
      }
    } else {
      throw err;
    }
  }

  if (!product || (product as any).isOrderable === false || (product as any).category?.isOrderable === false) {
    return null;
  }

  let groupProducts: typeof product[] = [];
  if (product.canonicalProductId && product.canonicalProductId.trim() !== "") {
    let foundGroup: any[] = [];
    try {
      foundGroup = await client.product.findMany({
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
    } catch {
      try {
        foundGroup = await client.product.findMany({
          where: {
            canonicalProductId: product.canonicalProductId,
            isActive: true,
          },
          include: {
            category: true,
            supplier: { select: { companyName: true } },
          },
          orderBy: { updatedAt: "desc" },
        });
      } catch {
        foundGroup = [product];
      }
    }
    groupProducts = Array.isArray(foundGroup) ? foundGroup : [];

    if (!groupProducts.some((p) => p.id === product.id)) {
      groupProducts.unshift(product);
    }
  } else {
    groupProducts = [product];
  }

  const eligibleProducts = groupProducts.filter(
    (p: any) => p.isOrderable !== false && p.category?.isOrderable !== false
  );
  if (eligibleProducts.length === 0) {
    return null;
  }

  const candidates = eligibleProducts.map(productToResolutionCandidate);
  const resolution = resolveLowestPriceForQuantity(candidates, quantity);

  return { product, candidates, resolution };
}

interface CachedMarkupStore {
  rows: Array<{ scope: string; scopeId: string | null; percentage: unknown; isEnabled: boolean }> | null;
  expiresAt: number;
}

let markupCache: CachedMarkupStore = { rows: null, expiresAt: 0 };

export async function getCachedMarkupRows(client: any): Promise<Array<{ scope: string; scopeId: string | null; percentage: unknown; isEnabled: boolean }>> {
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const now = Date.now();
  if (!isTest && markupCache.rows && markupCache.expiresAt > now) {
    return markupCache.rows;
  }
  const dbClient = client || prisma;
  if (!dbClient?.markupSetting?.findMany) {
    return [];
  }
  const rows = await dbClient.markupSetting.findMany({
    where: { isEnabled: true },
  });
  const validRows = Array.isArray(rows) ? rows : [];
  if (!isTest) {
    markupCache = {
      rows: validRows,
      expiresAt: now + 60_000,
    };
  }
  return validRows;
}

export function createCachedMarkupClient(rows: any[]) {
  return {
    markupSetting: {
      findMany: async (args?: any) => {
        if (!args?.where?.OR || !Array.isArray(args.where.OR)) {
          return rows;
        }
        return rows.filter((row: any) => {
          return args.where.OR.some((cond: any) => {
            if (cond.scope && cond.scope !== row.scope) return false;
            if (cond.scopeId !== undefined) {
              if (cond.scopeId === null) return row.scopeId === null;
              if (typeof cond.scopeId === "object" && cond.scopeId !== null && Array.isArray(cond.scopeId.in)) {
                return cond.scopeId.in.includes(row.scopeId);
              }
              if (typeof cond.scopeId === "string") return cond.scopeId === row.scopeId;
            }
            return true;
          });
        });
      },
    },
  };
}

export function invalidateMarkupCache(): void {
  markupCache = { rows: null, expiresAt: 0 };
}

/**
 * Returns the full, authoritative cart representation for a user with
 * admin-configured markups applied via batched database lookup.
 * Shared between GET /api/builder/cart and POST /api/builder/cart/items.
 */
export async function getCartForUser(userId: string, dbClient?: any): Promise<CartPayload> {
  const client = dbClient || prisma;
  await ensureCartSchema(client);

  let rawItems: any[] = [];
  try {
    rawItems = await client.cartItem.findMany({
      where: { userId },
      select: {
        id: true,
        productId: true,
        quantity: true,
        resolvedUnitPrice: true,
        resolvedSupplierId: true,
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
  } catch (err: any) {
    if (err?.code === "P2021" || err?.code === "P2022") {
      await ensureCartSchema(client);
      try {
        rawItems = await client.cartItem.findMany({
          where: { userId },
          select: {
            id: true,
            productId: true,
            quantity: true,
            product: {
              select: {
                name: true,
                unit: true,
                supplierId: true,
                categoryId: true,
                basePrice: true,
                images: true,
                supplier: { select: { companyName: true } },
              },
            },
          },
          orderBy: { updatedAt: "desc" },
        });
      } catch (fallbackErr) {
        console.error("getCartForUser fallback error:", fallbackErr);
        rawItems = [];
      }
    } else {
      throw err;
    }
  }
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

  const cachedRows = await getCachedMarkupRows(client).catch(() => null);
  const markupClient = cachedRows && cachedRows.length >= 0 ? createCachedMarkupClient(cachedRows) : (client as any);

  const markups = await resolveMarkupForProductsBatch(markupClient, batchParams).catch(
    () => items.map(() => null)
  );

  const itemsWithBuyerPrice = items.map((item: any, idx: number) => {
    const safeQuantity =
      Number.isFinite(item.quantity) && item.quantity >= 0.0001
        ? Math.round(item.quantity * 10000) / 10000
        : 1;
    const supplierUnitPrice = batchParams[idx].supplierUnitPrice;
    const markup = markups[idx];
    const unitPrice = markup ? markup.buyerUnitPrice : supplierUnitPrice;
    return { item, unitPrice, safeQuantity };
  });

  const subtotal = itemsWithBuyerPrice.reduce(
    (acc: number, { unitPrice, safeQuantity }: { unitPrice: number; safeQuantity: number }) =>
      acc + unitPrice * safeQuantity,
    0
  );

  return {
    items: itemsWithBuyerPrice.map(
      ({ item, unitPrice, safeQuantity }: { item: any; unitPrice: number; safeQuantity: number }) => ({
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
        quantity: safeQuantity,
        unitPrice,
        lineTotal: unitPrice * safeQuantity,
        aggregationEnabled: item.product.aggregationEnabled,
        aggregationPriceTiers: item.product.aggregationPriceTiers,
        aggregationWindowDays: item.product.aggregationWindowDays,
      })
    ),
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


