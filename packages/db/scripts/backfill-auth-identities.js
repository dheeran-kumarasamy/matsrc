#!/usr/bin/env node
// packages/db/scripts/backfill-auth-identities.js
//
// Unified Account Identity — read-then-write backfill for PRE-EXISTING
// Users created before the AuthIdentity table existed. This script is
// strictly additive and non-destructive:
//   - NEVER deletes, merges, or reassigns a User.
//   - NEVER rewrites User.email/User.phone.
//   - ONLY creates new AuthIdentity rows for mappings that are unambiguous.
//   - Idempotent: every insert uses the SAME (provider, providerIdentifier,
//     role) unique key AuthIdentity already enforces, so re-running this
//     script never creates duplicate identity rows (a second run's insert
//     attempt for an already-backfilled User simply no-ops on conflict).
//
// Usage (from repo root):
//   node packages/db/scripts/backfill-auth-identities.js --dry-run   # report only, no writes
//   node packages/db/scripts/backfill-auth-identities.js             # report + apply
//
// Requires DATABASE_URL / DIRECT_URL to be set in the environment, same as
// every other script in this directory. Run db:safety:preflight first if
// you are unsure which database your shell is pointed at.
//
// Mapping rules (deliberately conservative — anything ambiguous is
// reported, never guessed):
//   1. Placeholder-email Users (`{digits}@phone.buildohub.in` for BUILDER,
//      `{digits}@supplier.phone.buildohub.in` for SUPPLIER) -> one WHATSAPP
//      AuthIdentity, using User.phone (already normalized E.164) as the
//      identifier if present, otherwise the digits recovered from the
//      placeholder's local-part.
//   2. Users with a real (non-placeholder) email -> one EMAIL AuthIdentity
//      using the normalized (lowercased) email.
//   3. Users with a verified phone (`phoneVerifiedAt` set) that ALSO have a
//      real email -> an ADDITIONAL WHATSAPP AuthIdentity for that phone.
//      An unverified phone on a real-email User is reported as a conflict
//      candidate, never auto-linked — the audit calls out that "ownership"
//      of a field should follow the app's own verification semantics, not
//      merely whether the field happens to be populated.
//   4. No Google identities exist in the database at all (no Account
//      table, confirmed by the audit) — nothing to backfill for Google.

"use strict";

const path = require("path");
const fs = require("fs");

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

const { PrismaClient } = require("@prisma/client");

const DRY_RUN = process.argv.includes("--dry-run");

const BUYER_PLACEHOLDER_RE = /^(\d+)@phone\.buildohub\.in$/i;
const SUPPLIER_PLACEHOLDER_RE = /^(\d+)@supplier\.phone\.buildohub\.in$/i;

function isPlaceholderEmail(email) {
  if (!email) return null;
  const buyerMatch = email.match(BUYER_PLACEHOLDER_RE);
  if (buyerMatch) return { role: "BUILDER", digits: buyerMatch[1] };
  const supplierMatch = email.match(SUPPLIER_PLACEHOLDER_RE);
  if (supplierMatch) return { role: "SUPPLIER", digits: supplierMatch[1] };
  return null;
}

/** Tries to recover an E.164-ish phone from a placeholder's digits-only local-part. Falls back to User.phone if set. */
function resolveWhatsappIdentifier(user, placeholderDigits) {
  if (user.phone) return user.phone;
  if (!placeholderDigits) return null;
  return placeholderDigits.startsWith("91") ? `+${placeholderDigits}` : `+91${placeholderDigits}`;
}

async function createIdentityIfAbsent(prisma, { userId, provider, providerIdentifier, role }, stats, dryRunLabel) {
  if (!providerIdentifier) return;
  if (DRY_RUN) {
    stats.wouldCreate.push({ userId, provider, providerIdentifier, role });
    return;
  }
  try {
    await prisma.authIdentity.create({ data: { userId, provider, providerIdentifier, role } });
    stats.created += 1;
  } catch (error) {
    // P2002 = unique constraint violation — this exact (provider,
    // providerIdentifier, role) was already linked (e.g. a prior run of
    // this same script, or a login that happened after the migration was
    // applied but before this backfill ran). Idempotent: not an error.
    if (error && error.code === "P2002") {
      stats.alreadyLinked += 1;
      return;
    }
    throw error;
  }
}

async function main() {
  const prisma = new PrismaClient();
  const stats = { created: 0, alreadyLinked: 0, wouldCreate: [] };
  const conflicts = [];

  try {
    const users = await prisma.user.findMany({
      where: { role: { in: ["BUILDER", "SUPPLIER"] } },
      select: { id: true, email: true, phone: true, role: true, phoneVerifiedAt: true, emailVerifiedAt: true },
    });

    const placeholderCount = users.filter((u) => isPlaceholderEmail(u.email)).length;
    const realEmailCount = users.length - placeholderCount;
    const phoneCount = users.filter((u) => u.phone).length;

    console.log("Unified Account Identity — backfill analysis");
    console.log("----------------------------------------------");
    console.log(`Total Buyer/Supplier Users:     ${users.length}`);
    console.log(`Placeholder-email Users:        ${placeholderCount}`);
    console.log(`Real-email Users:               ${realEmailCount}`);
    console.log(`Users with a phone on file:      ${phoneCount}`);
    console.log(`Mode:                            ${DRY_RUN ? "DRY RUN (no writes)" : "APPLY"}`);
    console.log("");

    for (const user of users) {
      const placeholder = isPlaceholderEmail(user.email);

      if (placeholder) {
        // Rule 1: placeholder-email User -> one WHATSAPP identity.
        const identifier = resolveWhatsappIdentifier(user, placeholder.digits);
        if (!identifier) {
          conflicts.push({ userId: user.id, reason: "Placeholder email but no resolvable phone identifier" });
          continue;
        }
        await createIdentityIfAbsent(
          prisma,
          { userId: user.id, provider: "WHATSAPP", providerIdentifier: identifier, role: user.role },
          stats
        );
        continue;
      }

      // Rule 2: real-email User -> one EMAIL identity.
      if (user.email) {
        await createIdentityIfAbsent(
          prisma,
          { userId: user.id, provider: "EMAIL", providerIdentifier: user.email.trim().toLowerCase(), role: user.role },
          stats
        );
      }

      // Rule 3: a real-email User who ALSO has a phone is only backfilled
      // with a WHATSAPP identity if that phone has actually been verified
      // (phoneVerifiedAt set) — never inferred from the field merely being
      // populated (the audit explicitly calls this out).
      if (user.phone) {
        if (user.phoneVerifiedAt) {
          await createIdentityIfAbsent(
            prisma,
            { userId: user.id, provider: "WHATSAPP", providerIdentifier: user.phone, role: user.role },
            stats
          );
        } else {
          conflicts.push({
            userId: user.id,
            reason: "Has an unverified phone alongside a real email — not auto-linked; requires manual review",
          });
        }
      }
    }

    console.log(DRY_RUN ? "Would create the following AuthIdentity rows:" : "Backfill results:");
    if (DRY_RUN) {
      for (const row of stats.wouldCreate) {
        console.log(`  + ${row.provider} / ${row.providerIdentifier} / ${row.role} -> User ${row.userId}`);
      }
      console.log(`\nTotal would-create: ${stats.wouldCreate.length}`);
    } else {
      console.log(`  Created:        ${stats.created}`);
      console.log(`  Already linked: ${stats.alreadyLinked} (idempotent no-op)`);
    }

    if (conflicts.length > 0) {
      console.log("\nConflicts/ambiguous cases — NOT auto-linked, reported for manual review:");
      for (const c of conflicts) {
        console.log(`  - User ${c.userId}: ${c.reason}`);
      }
    } else {
      console.log("\nNo conflicts found.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exitCode = 1;
});
