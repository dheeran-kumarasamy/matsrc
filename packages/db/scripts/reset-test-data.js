#!/usr/bin/env node
// packages/db/scripts/reset-test-data.js
//
// Pre-launch cleanup: wipes ALL transactional/test data (Users, Products,
// Orders, Carts, Quotes, Invoices, Payments, Notifications, Sourcing
// sessions, etc.) so the platform can be used fresh for product/user
// registration and a clean test round.
//
// Deliberately PRESERVES reference/configuration data that the platform
// needs to keep functioning:
//   - Category, Brand, Grade, Unit               (product master data)
//   - NotificationTemplate                        (message templates)
//   - NotificationEventPolicy                      (notification engine config)
//   - NotificationGlobalSettings                   (singleton kill-switch)
//   - All Pricing* models (PricingState, PricingDistrict, PricingSource,
//     PricingMaterialCategory, PricingBrand, PricingCanonicalSku,
//     PricingSkuAlias, PricingUnitConversion, PricingSourceEndpoint,
//     PricingScrapeRun, PricingRawObservation, PricingObservation,
//     PricingAnomaly, PricingDistrictPriceDaily, PricingTrendMonthly,
//     PricingAlertEvaluation, PricingCostIndex)   (market pricing intelligence)
//
// Numbering sequences (EnquirySequence, InvoiceSequence, BusinessSequence)
// are RESET to zero/removed (not deleted as singleton rows) so fresh
// enquiry/order/invoice numbers start cleanly from 1 again.
//
// SAFETY: refuses to run against a database detected as production (by
// Neon endpoint ID and/or NODE_ENV/VERCEL_ENV), mirroring the guard rails in
// lib/db-safety.js. Requires explicit confirmation via `--yes` or
// CONFIRM_RESET=yes to avoid accidental invocation.
//
// Usage (from repo root):
//   pnpm --filter @matsrc/db db:reset-test-data -- --yes
//
// or:
//   CONFIRM_RESET=yes node packages/db/scripts/reset-test-data.js

"use strict";

const path = require("path");
const fs = require("fs");
// IMPORTANT: do NOT require("@prisma/client") at module top-level — Prisma
// Client auto-loads ".env" (via its own bundled dotenv) as a side effect of
// being required, which would win the race against the .env.local-first
// precedence below and could silently point this script at the wrong
// database. PrismaClient is required lazily, after env loading, below.
const { isProductionDatabase, detectEnvironment, redactConnectionString } = require("../lib/db-safety");

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const args = process.argv.slice(2);
const confirmed = args.includes("--yes") || process.env.CONFIRM_RESET === "yes";

// Required only now, after .env.local/.env have been loaded with the
// correct precedence above — see the comment near the top of this file.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Deletion order matters: children before parents, respecting every
// required (non-nullable) foreign key in prisma/schema.prisma. Models NOT
// listed here are reference/config data and are intentionally left alone.
const DELETE_ORDER = [
  "notificationDeliveryLog",
  "notificationPolicyAudit",
  "notificationEvent",
  "whatsAppMessageLog",
  "auditLog",
  "sourcingToolInvocation",
  "sourcingRecommendation",
  "productInterestEvent",
  "orderItemSupplierCandidate",
  "supplierQuote",
  "purchaseOrderLineItem",
  "invoiceLineItem",
  "advanceReservation",
  "customerAdvanceTransaction",
  "advancePayment",
  "paymentVerification",
  "orderTracking",
  "dispute",
  "supplierRating",
  "purchaseOrder",
  "invoice",
  "orderItem",
  "aggregationParticipant",
  "notification",
  "sourcingSession",
  "order",
  "aggregationPool",
  "customerAdvanceAccount",
  "cartItem",
  "watchlist",
  "quote",
  "quickRequest",
  "priceSnapshot",
  "pricingTier",
  "pricePoint",
  "mtcCertificate",
  "product",
  "canonicalProduct",
  "tallyLedgerMapping",
  "site",
  "kycDocument",
  "adminMenuPermission",
  "adminCredential",
  "pendingContactVerification",
  "otpChallenge",
  "authIdentity",
  "creditProfile",
  "notificationPreference",
  "supplierProfile",
  "user",
  "marketInsightCache",
];

async function main() {
  const environment = detectEnvironment(process.env);
  const databaseUrl = process.env.DATABASE_URL;
  const databaseIsProduction = databaseUrl ? isProductionDatabase(databaseUrl, process.env) : false;

  console.log("\nPre-launch test-data reset");
  console.log("---------------------------");
  console.log(`Environment:  ${environment}`);
  console.log(`DATABASE_URL: ${redactConnectionString(databaseUrl)}`);
  console.log(`Production detected: ${databaseIsProduction || environment === "production" ? "YES ⚠" : "NO"}`);
  console.log("");

  if (databaseIsProduction || environment === "production") {
    const overrideFlag = process.env.ALLOW_PRODUCTION_DB_OPERATION === "true";
    const productionConfirmPhrase = process.env.CONFIRM_PRODUCTION_RESET === "yes-i-am-sure";

    if (!overrideFlag || !productionConfirmPhrase) {
      console.error(
        "BLOCKED: this script refuses to run against a database detected as production " +
          "(by Neon endpoint ID and/or environment label). This operation is destructive " +
          "and irreversible — it must never target production without an explicit, " +
          "double-gated override.\n\n" +
          "To proceed against production anyway (e.g. a deliberate, backed-up pre-launch " +
          "reset), set BOTH of:\n" +
          "  ALLOW_PRODUCTION_DB_OPERATION=true\n" +
          "  CONFIRM_PRODUCTION_RESET=yes-i-am-sure\n"
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      "⚠  PRODUCTION OVERRIDE ACTIVE — both ALLOW_PRODUCTION_DB_OPERATION=true and " +
        "CONFIRM_PRODUCTION_RESET=yes-i-am-sure are set. Proceeding against PRODUCTION.\n"
    );
  }

  if (!confirmed) {
    console.error(
      "Refusing to proceed without explicit confirmation.\n\n" +
        "This will permanently delete ALL users, products, orders, carts, quotes,\n" +
        "invoices, payments, notifications, and sourcing data from the database above\n" +
        "(reference/config data — Categories, Brands, Grades, Units, Notification\n" +
        "templates, Pricing intelligence config — is preserved).\n\n" +
        "Re-run with --yes (or CONFIRM_RESET=yes) once you've confirmed the target above.\n"
    );
    process.exitCode = 1;
    return;
  }

  console.log("Deleting transactional/test data (children before parents)...\n");

  const counts = {};
  for (const model of DELETE_ORDER) {
    const result = await prisma[model].deleteMany({});
    counts[model] = result.count;
    if (result.count > 0) {
      console.log(`  ${model.padEnd(28)} -> ${result.count} row(s) deleted`);
    }
  }

  console.log("\nResetting numbering sequences...");
  await prisma.enquirySequence.updateMany({ data: { value: 0 } });
  await prisma.invoiceSequence.updateMany({ data: { value: 0 } });
  const businessSeq = await prisma.businessSequence.deleteMany({});
  console.log(`  EnquirySequence   -> reset to 0`);
  console.log(`  InvoiceSequence   -> reset to 0`);
  console.log(`  BusinessSequence  -> ${businessSeq.count} row(s) cleared (recreated lazily on next use)`);

  const totalDeleted = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\n✅ Reset complete. Total rows deleted: ${totalDeleted}`);
  console.log(
    "\nReference/config data preserved: Category, Brand, Grade, Unit, NotificationTemplate,\n" +
      "NotificationEventPolicy, NotificationGlobalSettings, and all Pricing* master/intelligence data.\n"
  );
  console.log(
    "Next step: recreate your admin login with:\n" +
      "  pnpm --filter @matsrc/db exec node scripts/create-admin-user.js <email> <password>\n"
  );
}

main()
  .catch((err) => {
    console.error("Failed to reset test data:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
