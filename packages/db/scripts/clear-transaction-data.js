#!/usr/bin/env node
// packages/db/scripts/clear-transaction-data.js
//
// Clears ALL transaction/activity data (orders, carts, payments, invoices,
// purchase orders, quotes, disputes, notifications, audit/WhatsApp logs,
// sourcing sessions, aggregation pools, advance-payment LEDGER rows, etc.)
// while preserving:
//   - ALL User and SupplierProfile rows (no logins/accounts are removed —
//     Product.supplierId is a required, non-cascading FK, so deleting
//     SupplierProfile/User rows would either be blocked by the DB or force
//     cascading into Product data, which must never be touched here)
//   - ALL CustomerAdvanceAccount rows AND their balances (availableBalance /
//     reservedBalance are never modified by this script — only the child
//     ledger/payment/reservation rows that reference an account are
//     cleared; the account row itself is left completely untouched)
//   - ALL Product data (Product, CanonicalProduct, MtcCertificate,
//     PricePoint, PricingTier, PriceSnapshot, ProductInterestEvent,
//     MarketInsightCache, Category, Brand, Grade, Unit, and every Pricing*
//     market-intelligence table)
//   - ALL user-linked config/profile data (KycDocument, CreditProfile,
//     NotificationPreference, AuthIdentity, AdminMenuPermission,
//     AdminCredential, OtpChallenge, PendingContactVerification, Site,
//     TallyLedgerMapping, NotificationTemplate, NotificationEventPolicy,
//     NotificationGlobalSettings)
//   - The EnquirySequence, InvoiceSequence, and BusinessSequence numbering
//     counters, exactly as they stand — this script no longer resets or
//     deletes them (see lib/clear-transaction-data.js's PRESERVED_MODELS).
//
// ONE-OFF EXCLUSION (see PRESERVE_ADVANCE_PAYMENT_REFERENCE below): this run
// additionally preserves one specific AdvancePayment (yesterday's,
// AP/2607/00001) plus its linked CustomerAdvanceTransaction (CREDIT ledger
// row) and AdvanceReceipt, while every other AdvancePayment/
// CustomerAdvanceTransaction/AdvanceReceipt row is still deleted as usual.
// Resolution fails closed: if that referenceNumber can't be found, the
// script throws before counting or deleting anything.
//
// ONE-OFF SEQUENCE RESET (see RESET_BUSINESS_SEQUENCE_IDS below): this run
// additionally resets the EQ_26/OD_26 BusinessSequence counters to 0, in
// the same atomic transaction as the deletion, so the next enquiry/order
// restarts from serial 00001. AP_26/AR_26 are deliberately left untouched
// (they back the preserved AP/2607/00001 payment/receipt). There is no
// "PO" BusinessSequence row — PurchaseOrder.poNumber is computed live from
// COUNT(*) FROM PurchaseOrder, so deleting the PurchaseOrder row(s) above
// is sufficient on its own.
//
// All deletion/reset decisions live in ../lib/clear-transaction-data.js as
// pure, injectable-prisma logic so they can be unit-tested offline with
// synthetic URLs and mocked Prisma delegates — see
// scripts/verify-clear-transaction-data.js.
//
// ATOMICITY IS MANDATORY: this script refuses to delete anything unless
// the decided strategy is a single atomic prisma.$transaction([...]) call
// covering every DELETE_ORDER table. If row counts are missing/invalid, or
// the data volume doesn't safely fit the transaction timeout, this script
// prints the reason and exits non-zero WITHOUT calling a single
// deleteMany. There is no non-atomic/sequential fallback, regardless of
// row-count size.
//
// SAFETY: refuses to run against a database detected as production (by
// Neon endpoint ID and/or NODE_ENV/VERCEL_ENV — detection applies even when
// the environment label claims "development"), and an absent/unparseable
// DATABASE_URL is treated as "cannot verify safety", never as "safe to
// proceed" (fail-closed). Requires explicit confirmation via `--yes` or
// CONFIRM_RESET=yes; production additionally requires BOTH
// ALLOW_PRODUCTION_DB_OPERATION=true AND CONFIRM_PRODUCTION_RESET=yes-i-am-sure
// — this production gate is entirely separate from, and never satisfied
// merely by, --yes/CONFIRM_RESET=yes.
//
// Usage (from repo root):
//   pnpm --filter @matsrc/db db:clear-transaction-data -- --yes
//
// or:
//   CONFIRM_RESET=yes node packages/db/scripts/clear-transaction-data.js
//
// Against production (both gates required; never set automatically by
// this script):
//   ALLOW_PRODUCTION_DB_OPERATION=true \
//   CONFIRM_PRODUCTION_RESET=yes-i-am-sure \
//   pnpm --filter @matsrc/db db:clear-transaction-data -- --yes

"use strict";

const path = require("path");
const fs = require("fs");
// IMPORTANT: do NOT require("@prisma/client") at module top-level — Prisma
// Client auto-loads ".env" (via its own bundled dotenv) as a side effect of
// being required, which would win the race against the .env.local-first
// precedence below and could silently point this script at the wrong
// database. PrismaClient is required lazily, after env loading, below.
const { redactConnectionString } = require("../lib/db-safety");
const {
  DELETE_ORDER,
  evaluateClearGate,
  countRowsToDelete,
  decideTransactionStrategy,
  executeDeletion,
  resolveAdvancePaymentPreservation,
} = require("../lib/clear-transaction-data");

// ONE-OFF EXCLUSION (this run only): yesterday's advance payment
// (AP/2607/00001, submitted 2026-10-12, ₹10,000, APPROVED) must be
// preserved — along with its linked CustomerAdvanceTransaction (CREDIT
// ledger row) and AdvanceReceipt — while every other
// transaction/activity row is cleared as usual. Every other AdvancePayment/
// CustomerAdvanceTransaction/AdvanceReceipt row (there are currently none
// besides this one in production) is still deleted unconditionally.
//
// Set to null to run a full, unconditional clear with no exclusion (prior
// behaviour) — do not repurpose this constant for a different payment
// without deliberately updating this comment and reference number.
const PRESERVE_ADVANCE_PAYMENT_REFERENCE = "AP/2607/00001";

// ONE-OFF SEQUENCE RESET (this run only): resets the EQ (Enquiry) and OD
// (Order) BusinessSequence counters back to 0, in the SAME atomic
// transaction as the deletion above, so the next enquiry/order created
// after this cleanup starts again from EQ/<fy>/00001 and OD/<fy>/00001.
// Deliberately does NOT include AP_26/AR_26 — those back the preserved
// AP/2607/00001 payment/receipt and must keep their current value so the
// next NEW advance payment is never assigned a number that collides with
// the one being kept. There is also no "PO" BusinessSequence row to reset:
// PurchaseOrder.poNumber (format "PO-YYYY-SSSSS") has no counter table at
// all — it is computed live as COUNT(*) FROM PurchaseOrder for the current
// year, so deleting the PurchaseOrder row(s) above (already in
// DELETE_ORDER) is sufficient on its own to return that count to 0.
//
// Set to null/empty to leave every BusinessSequence row untouched (prior
// behaviour) — do not repurpose this constant without deliberately
// updating this comment and the exact ids.
const RESET_BUSINESS_SEQUENCE_IDS = ["EQ_26", "OD_26"];

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

async function main() {
  const gate = evaluateClearGate({ env: process.env, confirmed });

  console.log(`Environment:  ${gate.identity.environment}`);
  console.log(`DATABASE_URL: ${redactConnectionString(process.env.DATABASE_URL)}`);
  console.log(`Production detected: ${gate.identity.isProduction ? "YES ⚠" : "NO"}`);
  console.log("");

  if (!gate.allowed) {
    console.error(gate.reason + "\n");
    if (!gate.identity.isProduction) {
      console.error(
        "This will permanently delete ALL transaction/activity data (orders, cart\n" +
          "items, quotes, quick requests, watchlists, invoices, purchase orders,\n" +
          "payment verifications, advance-payment LEDGER rows, disputes, supplier\n" +
          "ratings, notifications, audit/WhatsApp logs, aggregation pools, and\n" +
          "sourcing sessions) from the database above.\n\n" +
          "PRESERVED: every User, SupplierProfile, and CustomerAdvanceAccount row\n" +
          "(including balances), every Product/CanonicalProduct/pricing-history row,\n" +
          "every user-linked config table, and the EnquirySequence/InvoiceSequence/\n" +
          "BusinessSequence numbering counters (never reset or deleted).\n\n" +
          "Re-run with --yes (or CONFIRM_RESET=yes) once you've confirmed the target above.\n"
      );
    }
    process.exitCode = 1;
    return;
  }

  if (gate.productionOverrideUsed) {
    console.log(
      "⚠  PRODUCTION OVERRIDE ACTIVE — both ALLOW_PRODUCTION_DB_OPERATION=true and " +
        "CONFIRM_PRODUCTION_RESET=yes-i-am-sure are set, and --yes/CONFIRM_RESET=yes was " +
        "separately supplied. Proceeding against PRODUCTION.\n"
    );
  }

  // Resolve the one-off preservation target BEFORE any counting/deletion —
  // fail closed (throw, zero deleteMany calls) if the named AdvancePayment
  // can't be found, rather than silently proceeding as if there were
  // nothing to preserve. See resolveAdvancePaymentPreservation's own doc
  // comment in lib/clear-transaction-data.js.
  let preserve = null;
  if (PRESERVE_ADVANCE_PAYMENT_REFERENCE) {
    console.log(`Resolving preservation target: AdvancePayment ${PRESERVE_ADVANCE_PAYMENT_REFERENCE} ...`);
    preserve = await resolveAdvancePaymentPreservation(prisma, PRESERVE_ADVANCE_PAYMENT_REFERENCE);
    console.log(
      `  preserved advancePayment id=${preserve.advancePaymentId}, ` +
        `customerAdvanceTransaction id=${preserve.customerAdvanceTransactionId ?? "<none>"}, ` +
        `advanceReceipt id(s)=${preserve.advanceReceiptIds.length > 0 ? preserve.advanceReceiptIds.join(", ") : "<none>"}\n`
    );
  }

  console.log("Counting rows to delete (read-only)...");
  const rowCounts = await countRowsToDelete(prisma, preserve);
  const decision = decideTransactionStrategy(rowCounts);
  console.log(`Transaction strategy: ${decision.strategy} (atomic: ${decision.atomic})`);
  console.log(decision.reason + "\n");

  // Hard requirement: the cleanup must never proceed non-atomically. If the
  // decided strategy is anything other than a single atomic transaction,
  // refuse here — BEFORE calling executeDeletion — so zero deleteMany
  // calls are ever made. This script never switches to sequential
  // deletion, regardless of row-count size.
  if (decision.strategy !== "single-transaction" || decision.atomic !== true) {
    console.error(
      "BLOCKED: refusing to proceed. The cleanup can only run as a single atomic " +
        "transaction covering every table; the current data volume (or missing/invalid " +
        "row counts) means that could not be established as safe. No deleteMany calls " +
        "have been made — see the reason above. This script never falls back to a " +
        "non-atomic sequential deletion, even for large row counts.\n"
    );
    process.exitCode = 1;
    return;
  }

  console.log("Deleting transaction/activity data (children before parents)...\n");
  const resetSequenceIds =
    Array.isArray(RESET_BUSINESS_SEQUENCE_IDS) && RESET_BUSINESS_SEQUENCE_IDS.length > 0
      ? RESET_BUSINESS_SEQUENCE_IDS
      : null;
  if (resetSequenceIds) {
    console.log(`Also resetting BusinessSequence counters to 0 in the same transaction: ${resetSequenceIds.join(", ")}\n`);
  }

  const counts = await executeDeletion(prisma, decision, preserve, resetSequenceIds);
  for (const model of Object.keys(counts)) {
    if (counts[model] > 0) {
      const label = model === "businessSequenceReset" ? "businessSequence (reset)" : model;
      console.log(`  ${label.padEnd(28)} -> ${counts[model]} row(s) ${model === "businessSequenceReset" ? "reset" : "deleted"}`);
    }
  }

  const totalDeleted = DELETE_ORDER.reduce((acc, model) => acc + (counts[model] || 0), 0);
  console.log(`\n✅ Clear complete. Total rows deleted: ${totalDeleted}`);
  console.log(
    "\nPreserved: all User, SupplierProfile, CustomerAdvanceAccount (with balances intact),\n" +
      "Product, CanonicalProduct, pricing-history, user-linked config data (KycDocument,\n" +
      "CreditProfile, NotificationPreference, AuthIdentity, AdminCredential,\n" +
      "AdminMenuPermission, OtpChallenge, PendingContactVerification, Site,\n" +
      "TallyLedgerMapping, NotificationTemplate, NotificationEventPolicy,\n" +
      "NotificationGlobalSettings), and the EnquirySequence/InvoiceSequence\n" +
      "numbering counters (left exactly as they were)." +
      (preserve
        ? `\nAlso preserved (this run's one-off exclusion): AdvancePayment ${PRESERVE_ADVANCE_PAYMENT_REFERENCE} ` +
          "and its linked CustomerAdvanceTransaction/AdvanceReceipt."
        : "") +
      (resetSequenceIds
        ? `\nReset to 0 (this run's one-off sequence reset): BusinessSequence ${resetSequenceIds.join(", ")}.\n`
        : "\n")
  );
}

main()
  .catch((err) => {
    console.error("Failed to clear transaction data:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
