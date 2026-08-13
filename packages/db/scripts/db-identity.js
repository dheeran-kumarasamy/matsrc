#!/usr/bin/env node
// packages/db/scripts/db-identity.js
//
// Phase 6F-1 — Database Migration & Production Safety Hardening.
//
// Read-only diagnostic: reports which environment/database a developer's
// current shell is actually pointed at, without ever printing a credential.
// Intended to make it hard to accidentally confuse local/staging/production/
// shadow before running any Prisma command.
//
// Usage:
//   node packages/db/scripts/db-identity.js
//
// This script never connects to the database for anything beyond a
// trivial `SELECT version()` (server version confirmation) — it does not
// read or write application data.

const path = require("path");
const fs = require("fs");
const { redactConnectionString, detectEnvironment, isSameDatabaseIdentity } = require("../lib/db-safety");

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
  const environment = detectEnvironment(process.env);

  console.log("Database identity (credentials never printed):");
  console.log(`  environment:        ${environment}`);
  console.log(`  DATABASE_URL:       ${redactConnectionString(process.env.DATABASE_URL)}`);
  console.log(`  DIRECT_URL:         ${redactConnectionString(process.env.DIRECT_URL)}`);
  console.log(
    `  SHADOW_DATABASE_URL: ${process.env.SHADOW_DATABASE_URL ? redactConnectionString(process.env.SHADOW_DATABASE_URL) : "<not set>"}`
  );

  if (process.env.SHADOW_DATABASE_URL) {
    const sameAsDatabase = isSameDatabaseIdentity(process.env.SHADOW_DATABASE_URL, process.env.DATABASE_URL);
    const sameAsDirect = isSameDatabaseIdentity(process.env.SHADOW_DATABASE_URL, process.env.DIRECT_URL);
    if (sameAsDatabase || sameAsDirect) {
      console.log(
        "\n  ⚠ WARNING: SHADOW_DATABASE_URL resolves to the SAME database identity as " +
          `${sameAsDatabase ? "DATABASE_URL" : "DIRECT_URL"}. This is unsafe — a shadow database ` +
          "must be fully isolated. See docs/database/database-safety.md."
      );
    } else {
      console.log("\n  OK: SHADOW_DATABASE_URL is distinct from DATABASE_URL and DIRECT_URL.");
    }
  }

  if (!process.env.DATABASE_URL) {
    console.log("\nDATABASE_URL is not set — skipping live server-version check.");
    return;
  }

  try {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    const rows = await prisma.$queryRawUnsafe("SELECT version()");
    const version = rows && rows[0] && rows[0].version ? String(rows[0].version).split(",")[0] : "unknown";
    console.log(`\n  server version:     ${version}`);
    await prisma.$disconnect();
  } catch (err) {
    console.log(`\n  server version:     <could not connect: ${err instanceof Error ? err.message : String(err)}>`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
