import { prisma } from "@matsrc/db";
import { parsePhoneNumber } from "libphonenumber-js";
import { getDefaultCategoryImage } from "./category-images";
import {
  groupByCanonicalProduct,
  resolveHeadlinePrice,
  resolvePriceRange,
  type ResolutionCandidate,
} from "./resolution";
import { notifyBuilderOrderStatusUpdate } from "./notify";




type OrderStatus = "PLACED" | "PROCESSING" | "DISPATCHED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

type SupplierContext = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    whatsappNumber: string | null;
    kycStatus: "PENDING" | "APPROVED" | "REJECTED";
    supplierProfile: { id: string; companyName: string; bisLicenceNo: string | null } | null;
  };
  supplierProfile: { id: string; companyName: string; bisLicenceNo: string | null };
};

export type KycDocType = "GST_CERT" | "TRADE_LICENCE" | "BIS_CERT" | "AADHAAR";
export type KycDocStatus = {
  type: KycDocType;
  label: string;
  required: boolean;
  verified: boolean;
  fileUrl: string | null;
  submittedAt: string | null;
};

export type PricingTierInput = {
  minQty: string;
  maxQty: string;
  price: string;
};

type ListingInput = {
  title: string;
  category: string;
  grade: string;
  unit: string;
  maxServiceableQty: string;
  price: string;
  brand?: string;
  description?: string;
  pricingTiers?: PricingTierInput[];
  images?: string[];
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function formatCurrency(value: number | string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatDate(value: Date | null | undefined) {
  if (!value) return "TBD";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(value);
}

function humanizeToken(value: string) {
  return value.replace(/_/g, " ");
}

function mapOrderStatus(status: OrderStatus): "NEW" | "PACKING" | "IN_TRANSIT" {
  if (status === "DISPATCHED" || status === "OUT_FOR_DELIVERY") return "IN_TRANSIT";
  if (status === "PROCESSING") return "PACKING";
  return "NEW";
}

function isPoolTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Timed out fetching a new connection from the connection pool");
}

function isMissingPricingSchemaError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as {
    code?: string;
    meta?: { column?: string; table?: string };
    message?: string;
  };

  if (maybeError.code === "P2022" && maybeError.meta?.column?.includes("maxServiceableQty")) {
    return true;
  }

  if (maybeError.code === "P2021" && maybeError.meta?.table?.includes("PricingTier")) {
    return true;
  }

  const message = maybeError.message ?? "";
  return message.includes("maxServiceableQty") || message.includes("PricingTier");
}

async function ensurePricingSchema() {
  await prisma.$executeRawUnsafe('ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "maxServiceableQty" INTEGER;');
  await prisma.$executeRawUnsafe(
    'UPDATE "Product" SET "maxServiceableQty" = COALESCE("maxServiceableQty", "stock") WHERE "maxServiceableQty" IS NULL;'
  );
  await prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "PricingTier" ("id" TEXT PRIMARY KEY, "productId" TEXT NOT NULL, "minQty" INTEGER NOT NULL, "maxQty" INTEGER NOT NULL, "tierPrice" DECIMAL(12,2) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);'
  );
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PricingTier_productId_idx" ON "PricingTier"("productId");');
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "PricingTier_productId_minQty_maxQty_key" ON "PricingTier"("productId", "minQty", "maxQty");'
  );
  await prisma.$executeRawUnsafe(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PricingTier_productId_fkey') THEN ALTER TABLE "PricingTier" ADD CONSTRAINT "PricingTier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;`
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withPoolTimeoutRetry<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isPoolTimeoutError(error) || attempt === maxAttempts) {
        throw error;
      }

      await sleep(150 * attempt);
    }
  }

  throw new Error("Unexpected retry state while acquiring database connection");
}

export async function ensureSupplierContext(email: string): Promise<SupplierContext> {
  const user = await withPoolTimeoutRetry<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    whatsappNumber: string | null;
    kycStatus: "PENDING" | "APPROVED" | "REJECTED";
    supplierProfile: { id: string; companyName: string; bisLicenceNo: string | null } | null;
  }>(() =>
    prisma.user.findUniqueOrThrow({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        whatsappNumber: true,
        kycStatus: true,
        supplierProfile: true,
      },
    }),
  );

  if (!user.supplierProfile) {
    const profile = await withPoolTimeoutRetry(() =>
      prisma.supplierProfile.create({
        data: {
          userId: user.id,
          companyName: user.name ?? "BuildMart Demo Supplies",
        },
      }),
    );

    return { user, supplierProfile: profile as SupplierContext["supplierProfile"] };
  }

  return { user, supplierProfile: user.supplierProfile };
}

export type MarketScrollItem = {
  category: string;
  type: "market" | "mine";
  label: string;
  primaryValue: string;
  subValue: string;
  sharePercent: number | null;
};

export async function getMarketScrollerData(email: string): Promise<MarketScrollItem[]> {
  const { supplierProfile } = await ensureSupplierContext(email);

  const supplierCategories = await withPoolTimeoutRetry(() =>
    prisma.category.findMany({
      where: {
        products: {
          some: { supplierId: supplierProfile.id, isActive: true },
        },
      },
      select: { id: true, name: true },
    }),
  );

  if (supplierCategories.length === 0) return [];

  const categoryIds = supplierCategories.map((category) => category.id);
  const categoryMap = Object.fromEntries(supplierCategories.map((category) => [category.id, category.name]));

  type AggRow = {
    categoryId: string;
    totalQty: bigint | number | null;
    totalRevenue: bigint | number | null;
    myQty: bigint | number | null;
    myRevenue: bigint | number | null;
  };

  const rows = await withPoolTimeoutRetry<AggRow[]>(() =>
    prisma.$queryRaw`
      SELECT
        p."categoryId" AS "categoryId",
        COALESCE(SUM(oi.quantity), 0)::bigint AS "totalQty",
        COALESCE(SUM(oi.quantity * oi."unitPrice"), 0)::bigint AS "totalRevenue",
        COALESCE(SUM(CASE WHEN oi."supplierId" = ${supplierProfile.id} THEN oi.quantity ELSE 0 END), 0)::bigint AS "myQty",
        COALESCE(SUM(CASE WHEN oi."supplierId" = ${supplierProfile.id} THEN oi.quantity * oi."unitPrice" ELSE 0 END), 0)::bigint AS "myRevenue"
      FROM "OrderItem" oi
      JOIN "Product" p ON oi."productId" = p.id
      WHERE p."categoryId" = ANY(${categoryIds}::text[])
      GROUP BY p."categoryId"
    `,
  );

  const items: MarketScrollItem[] = [];

  for (const row of rows) {
    const category = categoryMap[row.categoryId] ?? "Products";
    const totalQty = Number(row.totalQty ?? 0);
    const totalRevenue = Number(row.totalRevenue ?? 0);
    const myQty = Number(row.myQty ?? 0);
    const myRevenue = Number(row.myRevenue ?? 0);
    const sharePercent = totalQty > 0 ? Math.round((myQty / totalQty) * 100) : 0;

    items.push({
      category,
      type: "market",
      label: `${category} · Platform Volume`,
      primaryValue: `${totalQty.toLocaleString("en-IN")} units`,
      subValue: `${formatCurrency(totalRevenue)} total platform revenue`,
      sharePercent: null,
    });

    items.push({
      category,
      type: "mine",
      label: `${category} · Your Delivery`,
      primaryValue: `${myQty.toLocaleString("en-IN")} units`,
      subValue: `${formatCurrency(myRevenue)} earned · ${sharePercent}% market share`,
      sharePercent,
    });
  }

  if (items.length === 0) {
    for (const category of supplierCategories) {
      items.push({
        category: category.name,
        type: "market",
        label: `${category.name} · Platform Volume`,
        primaryValue: "No orders yet",
        subValue: "Market volume appears once buyers place orders",
        sharePercent: null,
      });
    }
  }

  return items;
}

export async function getSupplierDashboardData(email: string) {
  const { supplierProfile } = await ensureSupplierContext(email);

  const [activeListings, confirmedIncomingOrders, pendingEnquiries, servedOrders, servedOrderItems] = await Promise.all([
    prisma.product.count({ where: { supplierId: supplierProfile.id, isActive: true } }),
    prisma.orderItem.findMany({
      where: {
        supplierId: supplierProfile.id,
        order: {
          status: {
            in: ["PROCESSING", "DISPATCHED", "OUT_FOR_DELIVERY"],
          },
        },
      },
      include: { product: true, order: true },
      orderBy: { order: { createdAt: "desc" } },
      take: 5,
    }),
    prisma.orderItem.findMany({
      where: {
        supplierId: supplierProfile.id,
        order: {
          status: "PLACED",
        },
      },
      include: { product: true, order: true },
      orderBy: { order: { createdAt: "desc" } },
      take: 5,
    }),
    prisma.order.count({ where: { status: "DELIVERED", items: { some: { supplierId: supplierProfile.id } } } }),
    prisma.orderItem.findMany({
      where: { supplierId: supplierProfile.id, order: { status: "DELIVERED" } },
      select: { quantity: true, unitPrice: true },
    }),
  ]);

  const servedOrderValue = servedOrderItems.reduce((total, item) => total + Number(item.unitPrice) * item.quantity, 0);

  return {
    kpis: [
      { label: "Active Listings", value: String(activeListings), hint: "Live SKUs visible to builders" },
      {
        label: "Incoming Orders",
        value: String(confirmedIncomingOrders.length),
        hint: "Confirmed orders after customer confirmation",
      },
      {
        label: "Pending Enquiries",
        value: String(pendingEnquiries.length),
        hint: "Submitted enquiries awaiting your decision",
      },
      { label: "Fulfilment Rate", value: String(servedOrders), hint: `${formatCurrency(servedOrderValue)} value served` },
    ],
    orders: confirmedIncomingOrders.map((item: any) => ({
      id: item.orderId,
      material: item.product.name,
      quantity: `${item.quantity} ${item.product.unit}`,
      eta: formatDate(item.deliveryDate ?? item.order.deliveryDate),
      status: mapOrderStatus(item.order.status),
    })),
    pendingEnquiries: pendingEnquiries.map((item: any) => ({
      id: item.orderId,
      material: item.product.name,
      quantity: `${item.quantity} ${item.product.unit}`,
      eta: formatDate(item.deliveryDate ?? item.order.deliveryDate),
    })),
  };
}

export async function getSupplierListings(email: string): Promise<SupplierListingRow[]> {
  const { supplierProfile } = await ensureSupplierContext(email);

  let listings: any[] = [];
  try {
    listings = await prisma.product.findMany({
      where: { supplierId: supplierProfile.id },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
    });
  } catch (error) {
    if (!isMissingPricingSchemaError(error)) throw error;
    listings = await prisma.product.findMany({
      where: { supplierId: supplierProfile.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        category: { select: { name: true } },
        grade: true,
        unit: true,
        basePrice: true,
        stock: true,
        isActive: true,
      },
    });
  }

  return listings.map((product: any) => ({
    id: product.id,
    name: product.name,
    category: product.category.name,
    grade: product.grade ?? "NA",
    unit: product.unit,
    price: `${formatCurrency(product.basePrice.toString())} / ${product.unit}`,
    stock: `${product.stock} ${product.unit}`,
    maxServiceableQty: `${product.maxServiceableQty ?? product.stock} ${product.unit}`,
    active: product.isActive,
    images:
      Array.isArray(product.images) && product.images.length > 0
        ? product.images
        : [getDefaultCategoryImage(product.category?.name)],
  }));
}

export async function getPublicSupplierListings() {
  let listings: any[] = [];

  try {
    listings = await prisma.product.findMany({
      where: { isActive: true },
      include: { category: true, pricingTiers: { orderBy: { minQty: "asc" } } },
      orderBy: { updatedAt: "desc" },
    });
  } catch (error) {
    if (!isMissingPricingSchemaError(error)) throw error;
    listings = await prisma.product.findMany({
      where: { isActive: true },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  const mapped = listings.map((product: any) => {
    const fallbackMaxQty = product.maxServiceableQty ?? product.stock;
    const pricingTiers = Array.isArray(product.pricingTiers) && product.pricingTiers.length > 0
      ? product.pricingTiers
      : [
          {
            minQty: 1,
            maxQty: fallbackMaxQty,
            tierPrice: product.basePrice,
          },
        ];

    return {
      id: product.id,
      supplierId: product.supplierId,
      canonicalProductId: product.canonicalProductId ?? null,
      name: product.name,
      category: product.category.name,
      grade: product.grade ?? "NA",
      unit: product.unit,
      price: `${formatCurrency(product.basePrice.toString())} / ${product.unit}`,
      stock: `${product.stock} ${product.unit}`,
      maxServiceableQty: `${fallbackMaxQty} ${product.unit}`,
      active: product.isActive,
      images:
        Array.isArray(product.images) && product.images.length > 0
          ? product.images
          : [getDefaultCategoryImage(product.category?.name)],
      pricingTiers: pricingTiers.map((tier: any) => ({
        minQty: String(tier.minQty),
        maxQty: String(tier.maxQty),
        price: String(tier.tierPrice),
      })),
      // Raw numeric fields kept alongside the formatted display fields above
      // (which existing consumers rely on) so the cross-supplier resolution
      // engine below can compute headline/grouped pricing without re-parsing
      // formatted strings.
      _basePriceRaw: Number(product.basePrice),
      _stockRaw: Number(product.stock),
      _maxServiceableQtyRaw: Number(fallbackMaxQty),
      _pricingTiersRaw: pricingTiers.map((tier: any) => ({
        minQty: Number(tier.minQty),
        maxQty: Number(tier.maxQty),
        tierPrice: Number(tier.tierPrice),
      })),
    };
  });

  // Cross-supplier canonical grouping (spec: "Product Discovery Duplicate
  // Listings — Cross-Supplier Price Resolution"): group listings that
  // represent the same physical product (same canonicalProductId) and
  // compute the lowest headline price + list of grouped listing ids, so the
  // builder discovery feed can collapse duplicates into a single card priced
  // at the lowest available price, while still returning every individual
  // listing (backward compatible for any consumer not yet updated).
  const groups = groupByCanonicalProduct(mapped as any);

  return mapped.map((listing: any) => {
    const groupKey = listing.canonicalProductId ?? listing.id;
    const group = groups.get(groupKey) ?? [listing];

    const candidates: ResolutionCandidate[] = group.map((item: any) => ({
      listingId: item.id,
      supplierId: item.supplierId,
      basePrice: item._basePriceRaw,
      stock: item._stockRaw,
      maxServiceableQty: item._maxServiceableQtyRaw,
      pricingTiers: item._pricingTiersRaw,
      isActive: item.active,
    }));

    const headline = resolveHeadlinePrice(candidates);
    const range = resolvePriceRange(candidates);

    const {
      _basePriceRaw,
      _stockRaw,
      _maxServiceableQtyRaw,
      _pricingTiersRaw,
      ...publicFields
    } = listing;

    return {
      ...publicFields,
      groupedListingIds: group.map((item: any) => item.id),
      headlinePrice: headline
        ? `${formatCurrency(headline.unitPrice)} / ${listing.unit}`
        : publicFields.price,
      headlineSupplierId: headline?.supplierId ?? listing.supplierId,
      // Min–max price range across the canonical group's active listings
      // (REQ-02). Raw numeric values (not formatted strings) so consumers
      // can format/compare as needed; null when unresolvable (no active
      // candidates), mirroring headline's fallback behavior.
      minPrice: range ? range.minPrice : null,
      maxPrice: range ? range.maxPrice : null,
    };
  });
}



export type SupplierListingRow = {
  id: string;
  name: string;
  category: string;
  grade: string;
  unit: string;
  price: string;
  stock: string;
  maxServiceableQty: string;
  active: boolean;
};

export async function getSupplierListingById(id: string, email: string) {
  const { supplierProfile } = await ensureSupplierContext(email);

  let product: any;
  try {
    product = await prisma.product.findFirst({
      where: { id, supplierId: supplierProfile.id },
      include: { category: true, pricingTiers: { orderBy: { minQty: "asc" } } },
    });
  } catch (error) {
    if (!isMissingPricingSchemaError(error)) throw error;
    product = await prisma.product.findFirst({
      where: { id, supplierId: supplierProfile.id },
      include: { category: true },
    });

    if (product) {
      product = {
        ...product,
        maxServiceableQty: product.stock,
        pricingTiers: [
          {
            minQty: 1,
            maxQty: product.stock,
            tierPrice: product.basePrice,
          },
        ],
      };
    }
  }

  if (!product) return null;

  return {
    id: product.id,
    title: product.name,
    category: product.category.name,
    grade: product.grade ?? "",
    unit: product.unit,
    maxServiceableQty: String(product.maxServiceableQty ?? product.stock),
    price: product.basePrice.toString(),
    brand: product.brand ?? "",
    description: product.description ?? "",
    pricingTiers: product.pricingTiers.map((tier: any) => ({
      minQty: String(tier.minQty),
      maxQty: String(tier.maxQty),
      price: tier.tierPrice.toString(),
    })),
    aggregationEnabled: Boolean(product.aggregationEnabled),
    aggregationPriceTiers: Array.isArray(product.aggregationPriceTiers) ? product.aggregationPriceTiers : [],
    aggregationWindowDays: product.aggregationWindowDays ?? 7,
    images: Array.isArray(product.images) ? product.images : [],
  };
}


function parsePositiveInt(value: string, field: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive whole number`);
  }
  return parsed;
}

function parsePositivePrice(value: string, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return parsed;
}

function normalizePricingTiers(tiers: PricingTierInput[] | undefined, maxServiceableQty: number, basePrice: number) {
  if (!tiers || tiers.length === 0) {
    return [
      {
        minQty: 1,
        maxQty: maxServiceableQty,
        tierPrice: basePrice,
      },
    ];
  }

  const normalized = tiers.map((tier, index) => {
    const minQty = parsePositiveInt(tier.minQty, `Tier ${index + 1} minimum quantity`);
    const maxQty = parsePositiveInt(tier.maxQty, `Tier ${index + 1} maximum quantity`);
    const tierPrice = parsePositivePrice(tier.price, `Tier ${index + 1} price`);

    if (minQty > maxQty) {
      throw new Error(`Tier ${index + 1} minimum quantity cannot exceed maximum quantity`);
    }

    return { minQty, maxQty, tierPrice };
  });

  normalized.sort((left, right) => left.minQty - right.minQty);

  if (normalized[0].minQty !== 1) {
    throw new Error("The first pricing tier must start at quantity 1");
  }

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (current.minQty !== previous.maxQty + 1) {
      throw new Error("Pricing tiers must be contiguous with no gaps or overlaps");
    }
  }

  if (normalized[normalized.length - 1].maxQty !== maxServiceableQty) {
    throw new Error("The final pricing tier must end at Maximum Serviceable Quantity");
  }

  return normalized;
}

// Resolves Brand/Grade/Unit free-text values (now guaranteed to be exact
// master-data matches since ListingForm only sends dropdown-selected values)
// to their FK ids, and finds-or-creates the CanonicalProduct row that groups
// this listing with any other supplier's listing for the "same" product
// (category + brand + grade + unit). Mirrors the logic in
// packages/db/scripts/backfill-catalog-master-data.js so canonicalKey stays
// consistent between the one-off backfill and ongoing listing writes.
async function resolveCanonicalAssignment(
  transaction: any,
  params: {
    categoryId: string;
    categoryName: string;
    brandName?: string | null;
    gradeName?: string | null;
    unitValue: string;
    title: string;
  }
) {
  const { categoryId, categoryName, brandName, gradeName, unitValue, title } = params;

  let brandId: string | null = null;
  if (brandName && brandName.trim()) {
    const brand = await transaction.brand.findFirst({ where: { name: brandName.trim() } });
    brandId = brand?.id ?? null;
  }

  let gradeId: string | null = null;
  if (gradeName && gradeName.trim()) {
    const grade = await transaction.grade.findFirst({ where: { name: gradeName.trim() } });
    gradeId = grade?.id ?? null;
  }

  let unitId: string | null = null;
  if (unitValue && unitValue.trim()) {
    const unit = await transaction.unit.findFirst({
      where: { OR: [{ code: unitValue.trim() }, { name: unitValue.trim() }] },
    });
    unitId = unit?.id ?? null;
  }

  const canonicalKey = [categoryId, brandId ?? "none", gradeId ?? "none", unitId ?? "none"].join(":");

  let canonical = await transaction.canonicalProduct.findUnique({ where: { canonicalKey } });
  if (!canonical) {
    const canonicalTitle = [categoryName, brandName, gradeName].filter(Boolean).join(" ") || title;
    canonical = await transaction.canonicalProduct.create({
      data: {
        canonicalKey,
        categoryId,
        brandId: brandId ?? undefined,
        gradeId: gradeId ?? undefined,
        unitId: unitId ?? undefined,
        title: canonicalTitle,
      },
    });
  }

  return { brandId, gradeId, unitId, canonicalProductId: canonical.id as string };
}

export async function createSupplierListing(input: ListingInput, email: string) {
  const { supplierProfile } = await ensureSupplierContext(email);
  const categoryName = input.category.trim();
  const category = await prisma.category.upsert({
    where: { slug: slugify(categoryName) },
    update: { name: categoryName },
    create: { name: categoryName, slug: slugify(categoryName) },
  });

  const slugBase = slugify(input.title);
  const suffix = Math.random().toString(36).slice(2, 7);
  const basePrice = parsePositivePrice(input.price, "Base Price");
  const maxServiceableQty = parsePositiveInt(input.maxServiceableQty, "Maximum Serviceable Quantity");
  const pricingTiers = normalizePricingTiers(input.pricingTiers, maxServiceableQty, basePrice);

  const createWithPricingSchema = () =>
    prisma.$transaction(async (transaction) => {
      const assignment = await resolveCanonicalAssignment(transaction, {
        categoryId: category.id,
        categoryName: category.name,
        brandName: input.brand,
        gradeName: input.grade,
        unitValue: input.unit,
        title: input.title,
      });

      const product = await transaction.product.create({
        data: {
          supplierId: supplierProfile.id,
          categoryId: category.id,
          name: input.title.trim(),
          slug: `${slugBase}-${suffix}`,
          brand: input.brand?.trim() || null,
          grade: input.grade.trim() || null,
          brandId: assignment.brandId ?? undefined,
          gradeId: assignment.gradeId ?? undefined,
          unitId: assignment.unitId ?? undefined,
          canonicalProductId: assignment.canonicalProductId,
          description: input.description?.trim() || null,
          unit: input.unit.trim().toUpperCase(),
          basePrice,
          stock: maxServiceableQty,
          maxServiceableQty,
          images: Array.isArray(input.images) ? input.images.filter((url) => url.trim().length > 0) : [],
          isActive: true,
        },
      });


      await transaction.pricingTier.createMany({
        data: pricingTiers.map((tier) => ({
          productId: product.id,
          minQty: tier.minQty,
          maxQty: tier.maxQty,
          tierPrice: tier.tierPrice,
        })),
      });

      return product;
    });

  try {
    return await createWithPricingSchema();
  } catch (error) {
    if (!isMissingPricingSchemaError(error)) throw error;
    await ensurePricingSchema();
    return createWithPricingSchema();
  }
}

export async function updateSupplierListing(id: string, input: ListingInput, email: string) {
  const existing = await getSupplierListingById(id, email);
  if (!existing) return null;

  const categoryName = input.category.trim();
  const category = await prisma.category.upsert({
    where: { slug: slugify(categoryName) },
    update: { name: categoryName },
    create: { name: categoryName, slug: slugify(categoryName) },
  });

  const basePrice = parsePositivePrice(input.price, "Base Price");
  const maxServiceableQty = parsePositiveInt(input.maxServiceableQty, "Maximum Serviceable Quantity");
  const pricingTiers = normalizePricingTiers(input.pricingTiers, maxServiceableQty, basePrice);

  const updateWithPricingSchema = () =>
    prisma.$transaction(async (transaction) => {
      const assignment = await resolveCanonicalAssignment(transaction, {
        categoryId: category.id,
        categoryName: category.name,
        brandName: input.brand,
        gradeName: input.grade,
        unitValue: input.unit,
        title: input.title,
      });

      const product = await transaction.product.update({
        where: { id },
        data: {
          categoryId: category.id,
          name: input.title.trim(),
          brand: input.brand?.trim() || null,
          grade: input.grade.trim() || null,
          brandId: assignment.brandId ?? undefined,
          gradeId: assignment.gradeId ?? undefined,
          unitId: assignment.unitId ?? undefined,
          canonicalProductId: assignment.canonicalProductId,
          description: input.description?.trim() || null,
          unit: input.unit.trim().toUpperCase(),
          basePrice,
          stock: maxServiceableQty,
          maxServiceableQty,
          ...(Array.isArray(input.images)
            ? { images: input.images.filter((url) => url.trim().length > 0) }
            : {}),
        },
      });


      await transaction.pricingTier.deleteMany({ where: { productId: id } });
      await transaction.pricingTier.createMany({
        data: pricingTiers.map((tier) => ({
          productId: id,
          minQty: tier.minQty,
          maxQty: tier.maxQty,
          tierPrice: tier.tierPrice,
        })),
      });

      return product;
    });

  try {
    return await updateWithPricingSchema();
  } catch (error) {
    if (!isMissingPricingSchemaError(error)) throw error;
    await ensurePricingSchema();
    return updateWithPricingSchema();
  }
}

export async function getSupplierOrders(email: string): Promise<SupplierOrderRow[]> {
  const { supplierProfile } = await ensureSupplierContext(email);

  const items = await prisma.orderItem.findMany({
    where: {
      supplierId: supplierProfile.id,
      order: {
        status: {
          in: ["PROCESSING", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"],
        },
      },
    },
    include: { order: { include: { user: true } }, product: true },
    orderBy: { order: { createdAt: "desc" } },
  });

  return items.map((item: any) => ({
    id: item.orderId,
    buyer: item.order.user.name ?? item.order.user.phone ?? "Builder",
    material: item.product.name,
    qty: `${item.quantity} ${item.product.unit}`,
    status: item.order.status,
    isAggregated: Boolean(item.order.isAggregated),
    aggregationPoolId: item.order.aggregationPoolId ?? null,
  }));
}

export type SupplierOrderRow = {
  id: string;
  buyer: string;
  material: string;
  qty: string;
  status: OrderStatus;
  isAggregated?: boolean;
  aggregationPoolId?: string | null;
};


export type SupplierTrackingStep = {
  id: string;
  label: string;
  status: OrderStatus;
};

export type SupplierOrderPurchaseOrderSummary = {
  id: string;
  poNumber: string;
  status: "DRAFT" | "ISSUED" | "ACKNOWLEDGED" | "FULFILLED";
  version: number;
  approvedAt: string | null;
  exportUrl: string;
};

export type SupplierOrderDetail = {
  id: string;
  buyer: string;
  deliveryDate: string;
  quantity: string;
  material: string;
  status: OrderStatus;
  tracking: SupplierTrackingStep[];
  purchaseOrder: SupplierOrderPurchaseOrderSummary | null;
  // REQ-06: the minimum price of the builder-facing price range at enquiry
  // time — the only price figure surfaced to the supplier. Falls back to
  // unitPrice for legacy orders created before this field existed.
  askPrice: string;
};



export type SupplierRfqCard = {
  id: string;
  material: string;
  quantity: string;
  pincode: string;
  dueBy: string;
  latestQuote: {
    price: string;
    validUntil: string | null;
  } | null;
};

export async function getSupplierOrderDetail(orderId: string, email: string): Promise<SupplierOrderDetail | null> {
  const { supplierProfile } = await ensureSupplierContext(email);

  const item = await prisma.orderItem.findFirst({
    where: { orderId, supplierId: supplierProfile.id },
    include: {
      order: {
        include: {
          user: true,
          tracking: { orderBy: { recordedAt: "asc" } },
        },
      },
      product: true,
    },
  });

  if (!item) return null;

  // Surface the PO number issued by the builder (if any) so it can be shown inside the
  // order details overlay, alongside a link to download it as PDF.
  const purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: { orderId, supplierId: supplierProfile.id },
    orderBy: { createdAt: "desc" },
  });

  return {
    id: item.orderId,
    buyer: item.order.user.name ?? item.order.user.phone ?? "Builder",
    deliveryDate: formatDate(item.deliveryDate ?? item.order.deliveryDate),
    quantity: `${item.quantity} ${item.product.unit}`,
    material: item.product.name,
    status: item.order.status,
    askPrice: `${formatCurrency((item as any).askPrice ?? item.unitPrice)} / ${item.product.unit}`,
    tracking: item.order.tracking.map((entry: any) => ({
      id: entry.id,
      label: entry.note ?? humanizeToken(entry.status),
      status: entry.status,
    })),
    purchaseOrder: purchaseOrder

      ? {
          id: purchaseOrder.id,
          poNumber: purchaseOrder.poNumber,
          status: purchaseOrder.status,
          version: purchaseOrder.version,
          approvedAt: purchaseOrder.approvedAt ? purchaseOrder.approvedAt.toISOString() : null,
          exportUrl: `/api/builder/purchase-orders/${purchaseOrder.id}/export`,
        }
      : null,
  };
}


export async function updateSupplierOrderStatus(orderId: string, status: OrderStatus) {
  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  const additionalData: Record<string, unknown> = {};

  // When the supplier confirms an enquiry directly (single-supplier flow, no competing
  // RFQ quotes), also finalize quote selection fields — mirrors what apps/api's
  // BestPriceSelectionService does for the multi-quote RFQ flow. Without this, the
  // builder-side Purchase Order generation (gated on quoteSelectionCompletedAt) never
  // unlocks for orders confirmed through this simpler supplier "Confirm Enquiry" action.
  if (
    status === "PROCESSING" &&
    existing &&
    !existing.quoteSelectionCompletedAt &&
    existing.items.length > 0
  ) {
    const supplierId = existing.items[0].supplierId;
    const allSameSupplier = existing.items.every((item) => item.supplierId === supplierId);
    const bestPriceTotal = existing.items.reduce(
      (sum, item) => sum + Number(item.unitPrice) * item.quantity,
      0
    );

    additionalData.selectedSupplierId = allSameSupplier ? supplierId : null;
    additionalData.bestPriceTotal = bestPriceTotal;
    additionalData.tentativeDeliveryDate =
      existing.tentativeDeliveryDate ??
      existing.deliveryDate ??
      new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    additionalData.quoteSelectionCompletedAt = new Date();
  }

  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status, ...additionalData },
  });

  await prisma.orderTracking.create({
    data: {
      orderId,
      status,
      note: `Supplier marked order as ${humanizeToken(status)}`,
    },
  });

  // REQ-08: Notify the builder/customer (best-effort, non-blocking) —
  // WhatsApp notification for each order status transition. Never blocks or
  // affects the status update above; failures are logged and swallowed
  // inside notifyBuilderOrderStatusUpdate itself.
  void notifyBuilderOrderStatusUpdate(orderId, status).catch((error) => {
    console.error(`Failed to send builder notification for order ${orderId}:`, error);
  });

  return order;
}



export async function getSupplierRfqs(email: string): Promise<SupplierRfqCard[]> {
  const { supplierProfile } = await ensureSupplierContext(email);

  const rfqs = await prisma.quickRequest.findMany({
    include: {
      quotes: {
        where: { supplierId: supplierProfile.id },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  return rfqs.map((rfq: any) => ({
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

export async function createSupplierQuote(
  rfqId: string,
  input: { price: string; validUntil?: string; notes?: string },
  email: string
) {
  const { supplierProfile } = await ensureSupplierContext(email);

  const rfq = await prisma.quickRequest.findUnique({ where: { id: rfqId } });
  if (!rfq) return null;

  return prisma.quote.create({
    data: {
      supplierId: supplierProfile.id,
      rfqId,
      price: Number(input.price),
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      notes: input.notes?.trim() || null,
    },
  });
}

export async function getSupplierProfileData(email: string) {
  const { user, supplierProfile } = await ensureSupplierContext(email);

  const docs = await prisma.kycDocument.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return {
    profile: {
      companyName: supplierProfile.companyName,
      contactName: user.name ?? "",
      email: user.email ?? "",
      phone: user.phone ?? "",
      whatsappNumber: user.whatsappNumber ?? "",
      bisLicenceNo: supplierProfile.bisLicenceNo ?? "",
    },
    kycItems: docs.map((doc: any) => ({
      doc: humanizeToken(doc.type),
      status: doc.verified ? "Verified" : "Pending",
    })),
  };
}

export async function updateSupplierProfile(
  input: {
    companyName: string;
    contactName: string;
    email: string;
    phone: string;
    whatsappNumber: string;
    bisLicenceNo: string;
  },
  callerEmail: string
) {
  const { user, supplierProfile } = await ensureSupplierContext(callerEmail);

  // Normalize phone numbers to E.164 format
  const normalizePhone = (phone: string | null | undefined): string | null => {
    if (!phone?.trim()) return null;
    try {
      const parsed = parsePhoneNumber(phone.trim(), "IN");
      return parsed?.isValid() ? parsed.format("E.164") : phone.trim();
    } catch {
      return phone.trim();
    }
  };

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: input.contactName.trim() || null,
      email: input.email.trim() || null,
      phone: normalizePhone(input.phone),
      whatsappNumber: normalizePhone(input.whatsappNumber),
    },
  });

  await prisma.supplierProfile.update({
    where: { id: supplierProfile.id },
    data: {
      companyName: input.companyName.trim() || supplierProfile.companyName,
      bisLicenceNo: input.bisLicenceNo.trim() || null,
    },
  });

  return getSupplierProfileData(callerEmail);
}

const KYC_DOC_META: Array<{ type: KycDocType; label: string; required: boolean }> = [
  { type: "GST_CERT", label: "GST Certificate", required: true },
  { type: "TRADE_LICENCE", label: "Trade Licence", required: true },
  { type: "BIS_CERT", label: "BIS Certificate", required: false },
  { type: "AADHAAR", label: "Aadhaar / ID Proof", required: true },
];

export async function getKycOnboardingData(email: string) {
  const { user, supplierProfile } = await ensureSupplierContext(email);

  const docs = await prisma.kycDocument.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const docMap = new Map(docs.map((doc) => [doc.type as KycDocType, doc]));

  return {
    companyName: supplierProfile.companyName,
    contactName: user.name ?? "",
    phone: user.phone ?? "",
    whatsappNumber: user.whatsappNumber ?? "",
    bisLicenceNo: supplierProfile.bisLicenceNo ?? "",
    kycStatus: user.kycStatus,
    docs: KYC_DOC_META.map((meta) => {
      const doc = docMap.get(meta.type);
      return {
        type: meta.type,
        label: meta.label,
        required: meta.required,
        verified: doc?.verified ?? false,
        fileUrl: doc?.fileUrl ?? null,
        submittedAt: doc?.createdAt ? doc.createdAt.toISOString() : null,
      } satisfies KycDocStatus;
    }),
  };
}

export async function upsertKycDocument(email: string, type: KycDocType, fileUrl: string) {
  const { user } = await ensureSupplierContext(email);

  const existing = await prisma.kycDocument.findFirst({ where: { userId: user.id, type } });

  if (existing) {
    await prisma.kycDocument.update({
      where: { id: existing.id },
      data: {
        fileUrl,
        verified: false,
      },
    });
    return;
  }

  await prisma.kycDocument.create({
    data: {
      userId: user.id,
      type,
      fileUrl,
      verified: false,
    },
  });
}

export async function submitOnboardingForReview(email: string) {
  const { user } = await ensureSupplierContext(email);

  await prisma.user.update({
    where: { id: user.id },
    data: { kycStatus: "PENDING" },
  });
}

// ─────────────────────────────────────────────
// Order Aggregation ("Group & Save") — Supplier
// ─────────────────────────────────────────────

const AGGREGATION_BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:4000/api";

async function callAggregationBackend<T>(path: string, email: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { user, supplierProfile } = await ensureSupplierContext(email);

  const response = await fetch(`${AGGREGATION_BACKEND_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": user.id,
      "X-User-Email": user.email ?? email,
      "X-User-Name": user.name ?? supplierProfile.companyName,
      "X-User-Role": "SUPPLIER",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Aggregation API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export type AggregationPriceTierInput = { minQty: string; unitPrice: string };

/**
 * Updates a listing's Order Aggregation ("Group & Save") configuration directly via Prisma.
 *
 * Note: unlike the other aggregation endpoints below (pools listing / force-lock), this does
 * NOT proxy to the standalone NestJS API via `callAggregationBackend` — the supplier Next.js
 * app already has direct database access (see `updateSupplierListing` above), and the NestJS
 * backend is not always deployed/reachable in every environment (its URL defaults to
 * `http://localhost:4000/api` via `BACKEND_API_URL`), which caused this endpoint to fail with
 * a 500 in production when that backend wasn't configured/available.
 */
export async function updateListingAggregationSettings(
  listingId: string,
  input: { aggregationEnabled: boolean; priceTiers?: AggregationPriceTierInput[]; defaultWindowDays?: string },
  email: string
) {
  const { supplierProfile } = await ensureSupplierContext(email);

  const listing = await prisma.product.findFirst({
    where: { id: listingId, supplierId: supplierProfile.id },
  });

  if (!listing) {
    throw new Error("Listing not found");
  }

  const priceTiers = (input.priceTiers ?? [])
    .filter((tier) => tier.minQty !== "" && tier.unitPrice !== "")
    .map((tier) => {
      const minQty = parsePositiveInt(tier.minQty, "Group pricing tier minimum quantity");
      const unitPrice = Number(tier.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error("Group pricing tier unit price must be a non-negative number");
      }
      return { minQty, unitPrice };
    })
    .sort((a, b) => a.minQty - b.minQty);

  if (input.aggregationEnabled && priceTiers.length === 0) {
    throw new Error("Add at least one group-pricing tier or disable Group Pricing.");
  }

  const defaultWindowDays = input.defaultWindowDays
    ? parsePositiveInt(input.defaultWindowDays, "Aggregation window (days)")
    : undefined;

  const product = await prisma.product.update({
    where: { id: listingId },
    data: {
      aggregationEnabled: input.aggregationEnabled,
      aggregationPriceTiers: input.aggregationEnabled ? (priceTiers as any) : undefined,
      aggregationWindowDays: defaultWindowDays,
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


export type SupplierAggregationPool = {
  id: string;
  supplierId: string;
  productId: string;
  productName: string;
  zoneKey: string;
  status: "OPEN" | "LOCKED" | "FULFILLING" | "CLOSED" | "CANCELLED";
  currentQuantity: number;
  priceTiers: { minQty: number; unitPrice: number }[];
  lockedUnitPrice: number | null;
  currentUnitPrice: number;
  nextTier: { minQty: number; unitPrice: number } | null;
  participantCount: number;
  projectedRevenueAtCurrentTier: number;
  projectedRevenueAtMaxTier: number;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  windowCloseAt: string;
  lockedAt: string | null;
};

export async function getSupplierAggregationPools(email: string): Promise<SupplierAggregationPool[]> {
  try {
    return await callAggregationBackend<SupplierAggregationPool[]>("/supplier/aggregation/pools", email);
  } catch {
    return [];
  }
}

export async function forceLockAggregationPool(poolId: string, email: string) {
  return callAggregationBackend(`/supplier/aggregation/pools/${poolId}/force-lock`, email, { method: "POST" });
}

