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

export async function getOrCreateBuilder(
  userId: string,
  email: string,
  name: string
) {
  let user = await prisma.user.findUnique({ where: { id: userId } });
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
    });
  }
  return user;
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

// Same as getUserCtx, but falls back to the NextAuth session cookie when the
// custom X-User-* headers are absent. Needed for routes that are hit via a
// plain browser navigation (e.g. <a href> download links, window.location
// redirects) instead of the fetch-based builderApi* helpers in lib/api.ts —
// those never attach the custom headers, only cookies. Mirrors lib/api.ts's
// convention where X-User-Id is the user's email.
export async function resolveUserCtx(request: Request) {
  const headers = request.headers;
  const userId = headers.get("X-User-Id");
  const email = headers.get("X-User-Email");
  if (userId && email) {
    return {
      userId,
      email,
      name: headers.get("X-User-Name") || "Builder",
    };
  }

  const session = await auth();
  if (!session?.user?.email) {
    throw new Error("UNAUTHENTICATED");
  }
  return {
    userId: session.user.email,
    email: session.user.email,
    name: session.user.name || "Builder",
  };
}



