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

// customer_order_status WhatsApp notification (Meta WhatsApp Cloud API via
// the Notification Engine tables) — the single shared, framework-agnostic
// implementation both apps/api (NestJS wrapper) and apps/supplier (direct)
// call so there is exactly one send path for this notification. See
// packages/db/lib/customer-order-status-notification.ts for full
// documentation.
export * from "./lib/customer-order-status-notification";

// supplier_quote_alert WhatsApp notification (SUPPLIER_RFQ_RECEIVED event,
// Meta WhatsApp Cloud API via the Notification Engine tables) — the single
// shared, framework-agnostic implementation apps/api (NestJS wrapper),
// apps/web (cart/checkout + Quick Material Request) and apps/supplier
// (candidate-promotion decline cascade) all call so there is exactly one
// send path for this notification. See
// packages/db/lib/supplier-rfq-received-notification.ts for full
// documentation.
export * from "./lib/supplier-rfq-received-notification";

// supplier_po_alert WhatsApp notification (SUPPLIER_PO_RECEIVED event, Meta
// WhatsApp Cloud API via the Notification Engine tables) — the single
// shared, framework-agnostic implementation apps/api (NestJS wrapper) and
// apps/web (builder PO approval route) call so there is exactly one send
// path for this notification. See
// packages/db/lib/supplier-po-received-notification.ts for full
// documentation.
export * from "./lib/supplier-po-received-notification";

// payment_required WhatsApp notification (PAYMENT_REQUIRED event, Meta
// WhatsApp Cloud API via the Notification Engine tables) — the single
// shared, framework-agnostic implementation apps/api (NestJS wrapper),
// apps/api's BestPriceSelectionService/supplier OrdersService, and
// apps/supplier (direct, supplier-portal "Confirm Enquiry" action) all call
// so there is exactly one send path for this notification. See
// packages/db/lib/payment-required-notification.ts for full documentation.
export * from "./lib/payment-required-notification";

// Shared OTP challenge lifecycle (generation/hashing/persistence/expiry/
// resend-cooldown/attempt-limiting/single-use) against the OtpChallenge
// Prisma model — used directly by apps/supplier's new LOGIN_OTP routes so
// there is exactly one OTP table/lifecycle definition shared with apps/web.
// See packages/db/lib/otp-challenge.ts for full documentation.
export * from "./lib/otp-challenge";

// buildohub_login_otp WhatsApp notification (LOGIN_OTP event, Meta WhatsApp
// Cloud API via the Notification Engine tables) — the single shared,
// framework-agnostic WhatsApp delivery used by the Buyer (apps/web) and
// Supplier (apps/supplier) portal "Send OTP on WhatsApp" login flow. NEVER
// generates/verifies OTPs — see packages/db/lib/login-otp-whatsapp-notification.ts
// for the full architectural boundary documentation.
export * from "./lib/login-otp-whatsapp-notification";

// Supplier RFQ Price Revision & GST-Inclusive Order Value — shared,
// framework-agnostic GST/line-total calculation used by both the
// NestJS RfqsService (apps/api) and the Next.js supplier portal
// (apps/supplier/lib/supplier-data.ts) so there is exactly one place this
// math is implemented. See packages/db/lib/gst-calculation.ts for full
// documentation.
export * from "./lib/gst-calculation";

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
