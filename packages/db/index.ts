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

// EQ/OD/IN business numbering — single source of truth for Enquiry/Order/
// Invoice identifiers (format: <TYPE>/<YYMM>/<SSSSS>). Supersedes the older
// enquiry-id.ts / invoice-number.ts generators above, which are kept only
// for reading back pre-migration IDs — see packages/db/lib/business-number.ts
// for full documentation.
export * from "./lib/business-number";

// OrderStatus -> customer-friendly display label — single source of truth
// for the Notification Engine's `customer_order_status` WhatsApp template
// (and any other backend code needing the same label). See
// packages/db/lib/order-status-labels.ts for full documentation.
export * from "./lib/order-status-labels";

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
