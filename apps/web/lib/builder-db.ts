import { PrismaClient, OrderStatus, PaymentStatus } from "@matsrc/db";

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

export function getUserCtx(request: Request) {
  const headers = request.headers;
  return {
    userId: headers.get("X-User-Id") ?? "builder.demo@buildmart.local",
    email: headers.get("X-User-Email") ?? "builder.demo@buildmart.local",
    name: headers.get("X-User-Name") ?? "Demo Builder",
  };
}
