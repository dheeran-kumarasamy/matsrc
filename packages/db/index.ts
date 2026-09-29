// packages/db/index.ts
export { PrismaClient } from "@prisma/client";
export * from "@prisma/client";

// Consolidated Enquiry ID generation — central helper shared by every
// Order-creation call site (apps/web/lib/order-checkout.ts,
// apps/api/src/builder/orders/orders.service.ts,
// apps/api/src/aggregation/aggregation.service.ts). See
// packages/db/lib/enquiry-id.ts for full documentation.
export * from "./lib/enquiry-id";

// Invoice number generation — central helper shared by the Admin-only
// invoice generation service (apps/api/src/admin/invoices/invoices.service.ts).
// See packages/db/lib/invoice-number.ts for full documentation.
export * from "./lib/invoice-number";

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
