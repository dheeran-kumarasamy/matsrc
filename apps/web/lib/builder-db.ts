import { PrismaClient, OrderStatus, PaymentStatus } from "@matsrc/db";
import { auth } from "@/auth";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma =
  globalForPrisma.prisma || new PrismaClient({ log: ["error"] });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export function resolveUnitPrice(product: any, quantity: number): number {
  const tiers = Array.isArray(product.pricingTiers) ? product.pricingTiers : [];
  const matched = tiers.find(
    (t: any) => quantity >= t.minQty && quantity <= t.maxQty
  );
  return Number(matched?.tierPrice ?? product.basePrice);
}

export function formatCurrency(amount: { toNumber?: () => number } | number | string): string {
  const n = Number(amount);
  return `₹${n.toLocaleString("en-IN")}`;
}

export function formatDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-IN");
}

let schemaEnsured = false;
let schemaEnsuringPromise: Promise<void> | null = null;

export async function ensureBuilderSchema(): Promise<void> {
  if (schemaEnsured) return;
  if (schemaEnsuringPromise) return schemaEnsuringPromise;

  schemaEnsuringPromise = (async () => {
    try {
      if (typeof (prisma as any)?.$executeRawUnsafe === "function") {
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isOrderable" BOOLEAN NOT NULL DEFAULT true;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "maxServiceableQty" DOUBLE PRECISION;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "isOrderable" BOOLEAN NOT NULL DEFAULT true;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe(
            'CREATE TABLE IF NOT EXISTS "OrderSplittingConfig" ("id" TEXT PRIMARY KEY DEFAULT \'global\', "allowMultiSupplierSplitting" BOOLEAN NOT NULL DEFAULT false, "splitOnlyAcrossCategories" BOOLEAN NOT NULL DEFAULT true, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedBy" TEXT);'
          )
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe(
            'CREATE TABLE IF NOT EXISTS "PricingTier" ("id" TEXT PRIMARY KEY, "productId" TEXT NOT NULL, "minQty" DOUBLE PRECISION NOT NULL, "maxQty" DOUBLE PRECISION NOT NULL, "tierPrice" DECIMAL(12,2) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);'
          )
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe(
            'CREATE TABLE IF NOT EXISTS "CartIdempotency" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "key" TEXT NOT NULL, "requestFingerprint" TEXT NOT NULL, "responseStatus" INTEGER NOT NULL DEFAULT 200, "responsePayload" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3));'
          )
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe(
            'CREATE TABLE IF NOT EXISTS "Watchlist" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "productId" TEXT NOT NULL, "targetPrice" DECIMAL(12,2), "alertSent" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);'
          )
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "templateType" TEXT;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "variables" TEXT;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT \'pending\';')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "whatsappNumber" TEXT;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3);')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legalName" TEXT;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tradeName" TEXT;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gstin" TEXT;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billingAddress" TEXT;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billingCity" TEXT;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billingState" TEXT;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "billingPincode" TEXT;')
          .catch(() => {});
        await (prisma as any)
          .$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "paymentDueDays" INTEGER NOT NULL DEFAULT 0;')
          .catch(() => {});
      }
      schemaEnsured = true;
    } catch (e) {
      console.warn("Builder schema self-healing notice (ignorable):", e);
    } finally {
      schemaEnsuringPromise = null;
    }
  })();

  return schemaEnsuringPromise;
}

export async function getOrCreateBuilder(
  userId: string,
  email: string,
  name: string
) {
  await ensureBuilderSchema().catch(() => {});
  const coreSelect = { id: true, email: true, name: true, role: true } as const;
  try {
    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      try {
        user = await prisma.user.upsert({
          where: { email },
          update: {},
          create: {
            id: userId,
            email,
            name,
            role: "BUILDER",
          },
        });
      } catch (err: any) {
        if (err?.code === "P2002") {
          user = await prisma.user.findUnique({ where: { email } });
        }
        if (!user) throw err;
      }
    }
    return user;
  } catch (err: any) {
    if (err?.code !== "P2022") throw err;
    schemaEnsured = false;
    await ensureBuilderSchema().catch(() => {});
    let user = await prisma.user.findUnique({ where: { id: userId }, select: coreSelect });
    if (!user) {
      user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          id: userId,
          email,
          name,
          role: "BUILDER",
        },
        select: coreSelect,
      });
    }
    return user as any;
  }
}

// Middleware (apps/web/middleware.ts) already rejects unauthenticated
// requests to /api/builder/* with a 401 before they reach these route
// handlers, so this should only ever be missing if a route is hit
// directly bypassing the middleware. Throwing here (instead of silently
// falling back to a demo identity) ensures no request can leak/mutate
// another user's data.
export function getUserCtx(request: Request) {
  const headers = request.headers;
  const userId = headers.get("X-User-Id");
  const email = headers.get("X-User-Email");
  if (!userId || !email) {
    throw new Error("UNAUTHENTICATED");
  }
  return {
    userId,
    email,
    name: headers.get("X-User-Name") || "Builder",
  };
}

// Authenticated session is the authoritative identity source. Client-supplied
// X-User-* headers can NEVER override the active session's identity.
export async function resolveUserCtx(request: Request) {
  const session = await auth().catch(() => null);
  const headers = request.headers;
  const headerUserId = headers.get("X-User-Id");
  const headerEmail = headers.get("X-User-Email");

  // If a valid server session exists, it is THE authoritative source of truth.
  // Client headers cannot override the authenticated user's session identity.
  if (session?.user?.email) {
    if (headerEmail && headerEmail.toLowerCase() !== session.user.email.toLowerCase()) {
      throw new Error("FORBIDDEN_IMPERSONATION");
    }
    if (
      headerUserId &&
      headerUserId !== session.user.id &&
      headerUserId.toLowerCase() !== session.user.email.toLowerCase()
    ) {
      throw new Error("FORBIDDEN_IMPERSONATION");
    }
    return {
      userId: session.user.id || session.user.email,
      email: session.user.email,
      name: session.user.name || "Builder",
    };
  }

  // Without a valid authenticated server session, client-supplied identity
  // headers can NEVER be accepted as proof of identity.
  throw new Error("UNAUTHENTICATED");
}



