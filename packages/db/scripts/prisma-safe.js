#!/usr/bin/env node
// packages/db/scripts/prisma-safe.js
//
// Phase 6F-1 — Database Migration & Production Safety Hardening.
//
// Safe wrapper around the Prisma CLI. Runs databaseSafetyPreflight() BEFORE
// invoking `prisma` at all — if the preflight blocks the operation, no
// database command is executed, full stop.
//
// This wrapper does not replace `prisma` for every possible invocation; it
// covers the specific operations this repo's own scripts/docs recommend
// (see docs/database/database-safety.md "Safe Prisma commands"). Anything
// else should go through `pnpm exec prisma <command>` directly, per
// AGENTS.md's existing convention — this wrapper is additive, not a
// mandatory chokepoint enforced at the tooling level (Prisma itself has no
// hook for that), so it only helps for the operations that opt into it.
//
// Usage (from packages/db, or via `pnpm --filter @matsrc/db exec node
// scripts/prisma-safe.js <op> [...prisma args]`):
//
//   node scripts/prisma-safe.js generate
//   node scripts/prisma-safe.js validate
//   node scripts/prisma-safe.js migrate-deploy
//   node scripts/prisma-safe.js db-execute --file path/to/migration.sql --url "$DIRECT_URL"
//   node scripts/prisma-safe.js migrate-diff --from-migrations ./prisma/migrations \
//     --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --script
//
// POTENTIALLY_DESTRUCTIVE operations (migrate-dev, migrate-reset, db-push,
// migrate-diff, db-seed) are blocked outright when the environment is
// classified production, per databaseSafetyPreflight(). There is no
// same-process bypass flag — see ALLOW_PRODUCTION_DB_OPERATION in
// docs/database/database-safety.md for the only sanctioned override, which
// requires an explicit environment variable, not a CLI flag.

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { databaseSafetyPreflight } = require("../lib/db-safety-preflight");

// Prisma CLI auto-loads packages/db/.env when invoked directly, but THIS
// script's own preflight check needs to read DATABASE_URL/DIRECT_URL/
// SHADOW_DATABASE_URL from that same file BEFORE spawning `prisma` — so it
// loads it itself here. Minimal inline parser (no new dependency; this
// package does not otherwise depend on dotenv) — deliberately does not
// overwrite a variable already set in the real environment, matching
// dotenv's own default precedence.
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

loadEnvFile(path.join(__dirname, "..", ".env"));

// Maps this wrapper's operation names to the actual `prisma <...>` argv.
// Kept explicit (no argv passthrough beyond what's appended after the
// operation name) so this file can be read top-to-bottom as the full list
// of what this wrapper is capable of invoking.
const PRISMA_ARGS = {
  generate: ["generate"],
  validate: ["validate"],
  format: ["format"],
  studio: ["studio"],
  "migrate-deploy": ["migrate", "deploy"],
  "migrate-dev": ["migrate", "dev"],
  "migrate-reset": ["migrate", "reset"],
  "migrate-diff": ["migrate", "diff"],
  "db-push": ["db", "push"],
  "db-execute": ["db", "execute"],
};

function main() {
  const [operation, ...rest] = process.argv.slice(2);

  if (!operation || !PRISMA_ARGS[operation]) {
    console.error(
      `Usage: node scripts/prisma-safe.js <${Object.keys(PRISMA_ARGS).join("|")}> [...prisma args]`
    );
    process.exitCode = 1;
    return;
  }

  const result = databaseSafetyPreflight({ operation });

  console.log("Database safety preflight:");
  console.log(`  environment:     ${result.context.environment}`);
  console.log(`  operation:       ${result.context.operation} (${result.context.operationClass})`);
  console.log(`  database target: ${result.context.databaseTarget}`);
  if (result.context.directTarget) console.log(`  direct target:   ${result.context.directTarget}`);
  if (result.context.shadowTarget) console.log(`  shadow target:   ${result.context.shadowTarget}`);

  if (!result.safe) {
    console.error("\n" + result.reason);
    process.exitCode = 1;
    return;
  }

  if (result.warning) console.warn("\nWARNING: " + result.warning);
  if (result.notice) console.log("\nNOTICE: " + result.notice);

  console.log(`\nRunning: prisma ${[...PRISMA_ARGS[operation], ...rest].join(" ")}\n`);

  // Uses `pnpm exec prisma`, never `npx prisma` — this repo's AGENTS.md and
  // .clinerules explicitly prohibit `npx prisma`; `pnpm exec` resolves the
  // workspace-pinned Prisma version instead of potentially fetching a
  // different one ad hoc.
  const child = spawnSync("pnpm", ["exec", "prisma", ...PRISMA_ARGS[operation], ...rest], {
    stdio: "inherit",
    env: process.env,
    cwd: __dirname + "/..",
  });

  process.exitCode = child.status === null ? 1 : child.status;
}

main();
