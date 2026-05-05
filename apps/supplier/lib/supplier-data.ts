import { OrderStatus, Role, prisma } from "@matsrc/db";

const DEV_SUPPLIER_EMAIL = "supplier.demo@buildmart.local";

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
  if (status === OrderStatus.DISPATCHED || status === OrderStatus.OUT_FOR_DELIVERY) return "IN_TRANSIT";
  if (status === OrderStatus.PROCESSING) return "PACKING";
  return "NEW";
}

function isPoolTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Timed out fetching a new connection from the connection pool");
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withPoolTimeoutRetry<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

export async function ensureSupplierContext() {
  const user = await withPoolTimeoutRetry(() =>
    prisma.user.upsert({
      where: { email: DEV_SUPPLIER_EMAIL },
      update: { role: Role.SUPPLIER, name: "Demo Supplier" },
      create: {
        email: DEV_SUPPLIER_EMAIL,
        name: "Demo Supplier",
        phone: "+919000011111",
        role: Role.SUPPLIER,
        whatsappNumber: "+919000011111",
        supplierProfile: {
          create: {
            companyName: "BuildMart Demo Supplies",
          },
        },
      },
      include: {
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

    return { user, supplierProfile: profile };
  }

  return { user, supplierProfile: user.supplierProfile };
}

export async function getSupplierDashboardData() {
  const { supplierProfile } = await ensureSupplierContext();

  const [activeListings, incomingOrders, openRfqs, deliveredOrders, totalOrderItems] = await Promise.all([
    prisma.product.count({ where: { supplierId: supplierProfile.id, isActive: true } }),
    prisma.orderItem.findMany({
      where: { supplierId: supplierProfile.id },
      include: { product: true, order: true },
      orderBy: { order: { createdAt: "desc" } },
      take: 5,
    }),
    prisma.quickRequest.count(),
    prisma.orderItem.count({ where: { supplierId: supplierProfile.id, order: { status: OrderStatus.DELIVERED } } }),
    prisma.orderItem.count({ where: { supplierId: supplierProfile.id } }),
  ]);

  const fulfilment = totalOrderItems === 0 ? 0 : Math.round((deliveredOrders / totalOrderItems) * 100);

  return {
    kpis: [
      { label: "Active Listings", value: String(activeListings), hint: "Live SKUs visible to builders" },
      { label: "Incoming Orders", value: String(incomingOrders.length), hint: "Recent order items assigned to you" },
      { label: "Open RFQs", value: String(openRfqs), hint: "Quick requests awaiting supplier quotes" },
      { label: "Fulfilment Rate", value: `${fulfilment}%`, hint: "Delivered supplier order items" },
    ],
    orders: incomingOrders.map((item) => ({
      id: item.orderId,
      material: item.product.name,
      quantity: `${item.quantity} ${item.product.unit}`,
      eta: formatDate(item.deliveryDate ?? item.order.deliveryDate),
      status: mapOrderStatus(item.order.status),
    })),
  };
}

export async function getSupplierListings(): Promise<SupplierListingRow[]> {
  const { supplierProfile } = await ensureSupplierContext();

  const listings = await prisma.product.findMany({
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

export type SupplierListingRow = {
  id: string;
  name: string;
  category: string;
  grade: string;
  unit: string;
  price: string;
  stock: string;
  active: boolean;
};

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

export async function getSupplierListingById(id: string) {
  const { supplierProfile } = await ensureSupplierContext();

  const product = await prisma.product.findFirst({
    where: { id, supplierId: supplierProfile.id },
    include: { category: true },
  });

  if (!product) return null;

  return {
    id: product.id,
    title: product.name,
    category: product.category.name,
    grade: product.grade ?? "",
    unit: product.unit,
    stock: String(product.stock),
    price: product.basePrice.toString(),
    brand: product.brand ?? "",
    description: product.description ?? "",
  };
}

type ListingInput = {
  title: string;
  category: string;
  grade: string;
  unit: string;
  stock: string;
  price: string;
  brand?: string;
  description?: string;
};

export async function createSupplierListing(input: ListingInput) {
  const { supplierProfile } = await ensureSupplierContext();
  const categoryName = input.category.trim();
  const category = await prisma.category.upsert({
    where: { slug: slugify(categoryName) },
    update: { name: categoryName },
    create: { name: categoryName, slug: slugify(categoryName) },
  });

  const slugBase = slugify(input.title);
  const suffix = Math.random().toString(36).slice(2, 7);

  return prisma.product.create({
    data: {
      supplierId: supplierProfile.id,
      categoryId: category.id,
      name: input.title.trim(),
      slug: `${slugBase}-${suffix}`,
      brand: input.brand?.trim() || null,
      grade: input.grade.trim() || null,
      description: input.description?.trim() || null,
      unit: input.unit.trim().toUpperCase(),
      basePrice: Number(input.price),
      stock: Number(input.stock),
      images: [],
      isActive: true,
    },
  });
}

export async function updateSupplierListing(id: string, input: ListingInput) {
  const existing = await getSupplierListingById(id);
  if (!existing) return null;

  const categoryName = input.category.trim();
  const category = await prisma.category.upsert({
    where: { slug: slugify(categoryName) },
    update: { name: categoryName },
    create: { name: categoryName, slug: slugify(categoryName) },
  });

  return prisma.product.update({
    where: { id },
    data: {
      categoryId: category.id,
      name: input.title.trim(),
      brand: input.brand?.trim() || null,
      grade: input.grade.trim() || null,
      description: input.description?.trim() || null,
      unit: input.unit.trim().toUpperCase(),
      basePrice: Number(input.price),
      stock: Number(input.stock),
    },
  });
}

export async function getSupplierOrders(): Promise<SupplierOrderRow[]> {
  const { supplierProfile } = await ensureSupplierContext();

  const items = await prisma.orderItem.findMany({
    where: { supplierId: supplierProfile.id },
    include: { order: { include: { user: true } }, product: true },
    orderBy: { order: { createdAt: "desc" } },
  });

  return items.map((item) => ({
    id: item.orderId,
    buyer: item.order.user.name ?? item.order.user.phone ?? "Builder",
    material: item.product.name,
    qty: `${item.quantity} ${item.product.unit}`,
    status: item.order.status,
  }));
}

export async function getSupplierOrderDetail(orderId: string): Promise<SupplierOrderDetail | null> {
  const { supplierProfile } = await ensureSupplierContext();

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
    tracking: item.order.tracking.map((entry) => ({
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

export async function getSupplierRfqs(): Promise<SupplierRfqCard[]> {
  const { supplierProfile } = await ensureSupplierContext();

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

  return rfqs.map((rfq) => ({
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
  input: { price: string; validUntil?: string; notes?: string }
) {
  const { supplierProfile } = await ensureSupplierContext();

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

export async function getSupplierProfileData() {
  const { user, supplierProfile } = await ensureSupplierContext();

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
    kycItems: docs.map((doc) => ({
      doc: humanizeToken(doc.type),
      status: doc.verified ? "Verified" : "Pending",
    })),
  };
}

export async function updateSupplierProfile(input: {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  whatsappNumber: string;
  bisLicenceNo: string;
}) {
  const { user, supplierProfile } = await ensureSupplierContext();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: input.contactName.trim() || null,
      email: input.email.trim() || null,
      phone: input.phone.trim() || null,
      whatsappNumber: input.whatsappNumber.trim() || null,
    },
  });

  return prisma.supplierProfile.update({
    where: { id: supplierProfile.id },
    data: {
      companyName: input.companyName.trim(),
      bisLicenceNo: input.bisLicenceNo.trim() || null,
    },
  });
}