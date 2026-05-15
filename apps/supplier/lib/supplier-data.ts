import { prisma } from "@matsrc/db";

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

  const [activeListings, incomingOrders, openRfqs, servedOrders, servedOrderItems] = await Promise.all([
    prisma.product.count({ where: { supplierId: supplierProfile.id, isActive: true } }),
    prisma.orderItem.findMany({
      where: { supplierId: supplierProfile.id },
      include: { product: true, order: true },
      orderBy: { order: { createdAt: "desc" } },
      take: 5,
    }),
    prisma.quickRequest.count(),
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
      { label: "Incoming Orders", value: String(incomingOrders.length), hint: "Recent order items assigned to you" },
      { label: "Pending Enquiries", value: String(openRfqs), hint: "Quick requests awaiting supplier quotes" },
      { label: "Fulfilment Rate", value: String(servedOrders), hint: `${formatCurrency(servedOrderValue)} value served` },
    ],
    orders: incomingOrders.map((item: any) => ({
      id: item.orderId,
      material: item.product.name,
      quantity: `${item.quantity} ${item.product.unit}`,
      eta: formatDate(item.deliveryDate ?? item.order.deliveryDate),
      status: mapOrderStatus(item.order.status),
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
  }));
}

export async function getPublicSupplierListings(): Promise<SupplierListingRow[]> {
  let listings: any[] = [];

  try {
    listings = await prisma.product.findMany({
      where: { isActive: true },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
    });
  } catch (error) {
    if (!isMissingPricingSchemaError(error)) throw error;
    listings = await prisma.product.findMany({
      where: { isActive: true },
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
  }));
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
  };
}

function parsePositiveInt(value: string, field: string) {
  const parsed = Number(value.trim().replace(/,/g, ""));
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive whole number`);
  }
  return parsed;
}

function parsePositivePrice(value: string, field: string) {
  const parsed = Number(value.trim().replace(/,/g, ""));
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
      const product = await transaction.product.create({
        data: {
          supplierId: supplierProfile.id,
          categoryId: category.id,
          name: input.title.trim(),
          slug: `${slugBase}-${suffix}`,
          brand: input.brand?.trim() || null,
          grade: input.grade.trim() || null,
          description: input.description?.trim() || null,
          unit: input.unit.trim().toUpperCase(),
          basePrice,
          stock: maxServiceableQty,
          maxServiceableQty,
          images: [],
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
      const product = await transaction.product.update({
        where: { id },
        data: {
          categoryId: category.id,
          name: input.title.trim(),
          brand: input.brand?.trim() || null,
          grade: input.grade.trim() || null,
          description: input.description?.trim() || null,
          unit: input.unit.trim().toUpperCase(),
          basePrice,
          stock: maxServiceableQty,
          maxServiceableQty,
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
    where: { supplierId: supplierProfile.id },
    include: { order: { include: { user: true } }, product: true },
    orderBy: { order: { createdAt: "desc" } },
  });

  return items.map((item: any) => ({
    id: item.orderId,
    buyer: item.order.user.name ?? item.order.user.phone ?? "Builder",
    material: item.product.name,
    qty: `${item.quantity} ${item.product.unit}`,
    status: item.order.status,
  }));
}

export type SupplierOrderRow = {
  id: string;
  buyer: string;
  material: string;
  qty: string;
  status: OrderStatus;
};

export type SupplierTrackingStep = {
  id: string;
  label: string;
  status: OrderStatus;
};

export type SupplierOrderDetail = {
  id: string;
  buyer: string;
  deliveryDate: string;
  quantity: string;
  material: string;
  status: OrderStatus;
  tracking: SupplierTrackingStep[];
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

  return {
    id: item.orderId,
    buyer: item.order.user.name ?? item.order.user.phone ?? "Builder",
    deliveryDate: formatDate(item.deliveryDate ?? item.order.deliveryDate),
    quantity: `${item.quantity} ${item.product.unit}`,
    material: item.product.name,
    status: item.order.status,
    tracking: item.order.tracking.map((entry: any) => ({
      id: entry.id,
      label: entry.note ?? humanizeToken(entry.status),
      status: entry.status,
    })),
  };
}

export async function updateSupplierOrderStatus(orderId: string, status: OrderStatus) {
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status },
  });

  await prisma.orderTracking.create({
    data: {
      orderId,
      status,
      note: `Supplier marked order as ${humanizeToken(status)}`,
    },
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

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: input.contactName.trim() || null,
      email: input.email.trim() || null,
      phone: input.phone.trim() || null,
      whatsappNumber: input.whatsappNumber.trim() || null,
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