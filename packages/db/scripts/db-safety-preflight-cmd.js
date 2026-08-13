#!/usr/bin/env node
// packages/db/scripts/db-safety-preflight-cmd.js
//
// Phase 6F-2 — db:safety:preflight command (spec §20).
//
// Read-only preflight that reports environment, database identity, Neon
// endpoint/project/branch, migration table status, and shadow database
// identity. Never modifies data. Safe to run at any time.
//
// Usage:
//   pnpm --filter @matsrc/db db:safety:preflight

"use strict";

const path = require("path");
const fs = require("fs");
const {
  redactConnectionString,
  detectEnvironment,
  isSameDatabaseIdentity,
  isProductionDatabase,
  getDatabaseIdentity,
  extractNeonEndpointId,
  KNOWN_PRODUCTION_IDENTIFIERS,
  KNOWN_PITR_BRANCH_ID,
} = require("../lib/db-safety");

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

// .env.local (gitignored) takes priority over .env for per-session overrides.
loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));


async function main() {
  const env = process.env;
  const environment = detectEnvironment(env);
  const databaseUrl = env.DATABASE_URL;
  const directUrl = env.DIRECT_URL;
  const shadowUrl = env.SHADOW_DATABASE_URL;

  const dbId = getDatabaseIdentity(databaseUrl, env);
  const directId = directUrl ? getDatabaseIdentity(directUrl, env) : null;
  const shadowId = shadowUrl ? getDatabaseIdentity(shadowUrl, env) : null;

  const shadowSameAsDatabase = shadowUrl && databaseUrl ? isSameDatabaseIdentity(shadowUrl, databaseUrl) : false;
  const shadowSameAsDirect = shadowUrl && directUrl ? isSameDatabaseIdentity(shadowUrl, directUrl) : false;
  const shadowSafe = !!(shadowId && shadowId.parseable && !shadowId.isProduction && !shadowSameAsDatabase && !shadowSameAsDirect);

  console.log("\n===== DATABASE SAFETY PREFLIGHT REPORT =====\n");
  console.log(`Environment:               ${environment}`);
  console.log("\n-- DATABASE_URL -----------------------------");
  console.log(`  Redacted:                ${dbId.redacted}`);
  console.log(`  Neon endpoint ID:        ${dbId.endpointId || "<not a Neon endpoint>"}`);
  console.log(`  Is production:           ${dbId.isProduction ? "YES (PRODUCTION)" : "NO"}`);
  if (directId) {
    console.log("\n-- DIRECT_URL -------------------------------");
    console.log(`  Redacted:                ${directId.redacted}`);
    console.log(`  Neon endpoint ID:        ${directId.endpointId || "<not a Neon endpoint>"}`);
    console.log(`  Is production:           ${directId.isProduction ? "YES (PRODUCTION)" : "NO"}`);
  }
  console.log("\n-- SHADOW_DATABASE_URL ----------------------");
  if (!shadowUrl) {
    console.log("  Status:                  NOT SET");
    console.log("  WARNING: migrate-diff is BLOCKED until SHADOW_DATABASE_URL is set.");
  } else if (!shadowId.parseable) {
    console.log("  Status:                  SET BUT UNPARSEABLE");
  } else {
    console.log(`  Redacted:                ${shadowId.redacted}`);
    console.log(`  Neon endpoint ID:        ${shadowId.endpointId || "<not a Neon endpoint>"}`);
    console.log(`  Is production:           ${shadowId.isProduction ? "YES (PRODUCTION - UNSAFE)" : "NO"}`);
    console.log(`  Same as DATABASE_URL:    ${shadowSameAsDatabase ? "YES (UNSAFE)" : "NO"}`);
    console.log(`  Same as DIRECT_URL:      ${shadowSameAsDirect ? "YES (UNSAFE)" : "NO"}`);
    console.log(`  Shadow safe to use:      ${shadowSafe ? "YES" : "NO - SEE WARNINGS ABOVE"}`);
  }
  console.log("\n-- KNOWN PRODUCTION IDENTIFIERS -------------");
  console.log(`  Neon project ID:         ${KNOWN_PRODUCTION_IDENTIFIERS.neonProjectId}`);
  console.log(`  Neon branch ID:          ${KNOWN_PRODUCTION_IDENTIFIERS.neonBranchId}`);
  console.log(`  Neon endpoint ID:        ${KNOWN_PRODUCTION_IDENTIFIERS.neonEndpointId}`);
  console.log(`  PITR evidence branch:    ${KNOWN_PITR_BRANCH_ID} (preserve - do not delete)`);
  if (databaseUrl) {
    console.log("\n-- LIVE DATABASE METADATA (read-only) -------");
    try {
      const { PrismaClient } = require("@prisma/client");
      const prisma = new PrismaClient();
      const [vRow] = await prisma.$queryRawUnsafe("SELECT version(), current_database(), current_user");
      console.log(`  Server version:          ${String(vRow.version).split(",")[0]}`);
      console.log(`  Database name:           ${vRow.current_database}`);
      console.log(`  Connected user:          ${vRow.current_user}`);
      try {
        const [mRow] = await prisma.$queryRawUnsafe(
          "SELECT COUNT(*) as cnt, MAX(finished_at) as last FROM _prisma_migrations WHERE applied_steps_count > 0"
        );
        console.log(`  Applied migrations:      ${mRow.cnt}`);
        console.log(`  Last applied:            ${mRow.last || "N/A"}`);
      } catch { console.log("  Migration table:         <could not query>"); }
      try {
        const [tRow] = await prisma.$queryRawUnsafe(
          "SELECT count(*) as cnt FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
        );
        console.log(`  Table count:             ${tRow.cnt}`);
      } catch { console.log("  Table count:             <could not query>"); }
      await prisma.$disconnect();
    } catch (err) {
      console.log(`  <could not connect: ${err instanceof Error ? err.message : String(err)}>`);
    }
  }
  console.log("\n-- OVERALL STATUS ---------------------------");
  if (dbId.isProduction) {
    console.log("  WARNING: DATABASE_URL points to PRODUCTION.");
    console.log("    Only CONTROLLED_WRITE ops (migrate deploy / db execute) are permitted.");
    console.log("    POTENTIALLY_DESTRUCTIVE ops (migrate diff/dev/reset, db push) are BLOCKED.");
  } else {
    console.log("  OK: DATABASE_URL does not appear to be the production endpoint.");
  }
  if (!shadowUrl) {
    console.log("  WARNING: SHADOW_DATABASE_URL is not set - migrate-diff is blocked.");
  } else if (shadowSafe) {
    console.log("  OK: SHADOW_DATABASE_URL is safe to use for migrate-diff.");
  } else {
    console.log("  ERROR: SHADOW_DATABASE_URL is UNSAFE - see details above.");
  }
  console.log("");
}

main().catch((err) => {
  console.error("Preflight error:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
