#!/usr/bin/env node
// packages/db/scripts/prisma-safe.js
//
// Phase 6F-2 — Database Migration Safety Hardening.
//
// Safe wrapper around the Prisma CLI. Runs databaseSafetyPreflight() BEFORE
// invoking `prisma` at all — if the preflight blocks, no database command
// is executed, full stop.
//
// Phase 6F-2 changes over Phase 6F-1:
//   - migrate-diff automatically injects --shadow-database-url from
//     SHADOW_DATABASE_URL after preflight passes. The wrapper OWNS this
//     parameter; passing --shadow-database-url manually is blocked.
//   - Safety summary table printed before every execution (spec §21).
//   - Audit log written to stderr for CI/CD capture (spec §24).
//
// Usage (via pnpm --filter @matsrc/db <script>):
//
//   pnpm --filter @matsrc/db db:safe:migrate-diff \
//     -- --from-migrations ./prisma/migrations \
//     --to-schema-datamodel ./prisma/schema.prisma --script
//
//   pnpm --filter @matsrc/db db:safe:migrate-deploy
//   pnpm --filter @matsrc/db db:safe:db-execute -- --file migration.sql --url "$DIRECT_URL"
//
// DO NOT pass --shadow-database-url manually — the wrapper injects it from
// SHADOW_DATABASE_URL after all safety checks pass.

"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { databaseSafetyPreflight } = require("../lib/db-safety-preflight");
const { isProductionDatabase, getNeonEndpointId } = require("../lib/db-safety");

// Load .env before running preflight (same logic as Phase 6F-1).
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

// Load env files in priority order (each call only sets vars NOT already set).
// Precedence: real shell env > .env.local > .env
// .env.local (gitignored) allows per-session DATABASE_URL/SHADOW_DATABASE_URL
// overrides for migrate-diff sessions without modifying .env.
loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));

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

/**
 * Prints the safety summary required by spec §21. No passwords/secrets.
 * All output goes to STDERR so that stdout is clean SQL-only when --script is used.
 */
function printSafetySummary(result) {
  const c = result.context;
  const shadowEndpoint = c.shadowTarget
    ? (getNeonEndpointId(process.env.SHADOW_DATABASE_URL) || "<non-neon>")
    : "<not set>";
  const log = (s) => process.stderr.write(s + "\n");
  log("\nDatabase Safety Preflight");
  log("-------------------------");
  log(`Environment:         ${c.environment}`);
  log(`Operation:           ${c.operation} (${c.operationClass})`);
  log(`Database target:     ${c.databaseTarget}`);
  if (c.directTarget) log(`Direct target:       ${c.directTarget}`);
  log(`Production target:   ${c.databaseIsProduction ? "YES ⚠" : "NO"}`);
  if (c.shadowTarget != null) {
    log(`Shadow target:       ${c.shadowTarget}`);
    log(`Shadow endpoint:     ${shadowEndpoint}`);
    log(`Shadow = production: ${c.shadowIsProduction ? "YES ⚠" : "NO"}`);
    log(`Shadow = DIRECT_URL: ${c.shadowEqualsDirect ? "YES ⚠" : "NO"}`);
  }
  log(`Migration action:    ${result.safe ? "SAFE ✓" : "BLOCKED ✗"}`);
  log("");
}

/** Writes a non-secret audit line to stderr for CI/CD capture (spec §24). */
function writeAuditLine(operation, result) {
  const ts = new Date().toISOString();
  const ci = process.env.CI ? "CI=true" : "CI=false";
  const outcome = result.safe ? "ALLOWED" : "BLOCKED";
  process.stderr.write(
    `[AUDIT] ${ts} | ${ci} | env=${result.context.environment} | op=${operation} | shadow=${result.context.shadowTarget || "N/A"} | outcome=${outcome}\n`
  );
}

function main() {
  const [operation, ...rawRest] = process.argv.slice(2);
  // Strip a leading `--` separator that pnpm injects when the caller uses
  // `pnpm --filter @matsrc/db db:safe:migrate-diff -- --from-migrations ...`
  // pnpm passes `--` as the first element of the extra args to mark the end
  // of pnpm options; Prisma does not understand it and errors.
  const rest = rawRest[0] === "--" ? rawRest.slice(1) : rawRest;

  if (!operation || !PRISMA_ARGS[operation]) {
    console.error(`Usage: node scripts/prisma-safe.js <${Object.keys(PRISMA_ARGS).join("|")}> [...prisma args]`);
    process.exitCode = 1;
    return;
  }

  // Block manual --shadow-database-url injection for migrate-diff (spec §12).
  if (operation === "migrate-diff") {
    const hasShadowArg = rest.some(
      (a) => a === "--shadow-database-url" || a.startsWith("--shadow-database-url=")
    );
    if (hasShadowArg) {
      console.error(
        "\nBLOCKED: Do not pass --shadow-database-url manually.\n\n" +
          "The wrapper injects it from SHADOW_DATABASE_URL after all safety checks pass.\n" +
          "Set SHADOW_DATABASE_URL in your .env and re-run without --shadow-database-url.\n\n" +
          "Historical note: manually passing DIRECT_URL here caused the Phase 6F data-loss incident.\n" +
          "See docs/database/phase-6f-1-safety-hardening-report.md"
      );
      process.exitCode = 1;
      return;
    }
  }

  const result = databaseSafetyPreflight({ operation });

  printSafetySummary(result);
  writeAuditLine(operation, result);

  if (!result.safe) {
    console.error(result.reason);
    process.exitCode = 1;
    return;
  }

  // All wrapper messages go to stderr so stdout is clean SQL when --script is used.
  if (result.warning) process.stderr.write("WARNING: " + result.warning + "\n");
  if (result.notice) process.stderr.write("NOTICE: " + result.notice + "\n");

  // For migrate-diff, inject --shadow-database-url from SHADOW_DATABASE_URL.
  // Preflight already verified it is safe.
  let finalArgs;
  if (operation === "migrate-diff") {
    const shadowUrl = process.env.SHADOW_DATABASE_URL;
    finalArgs = [...PRISMA_ARGS[operation], ...rest, "--shadow-database-url", shadowUrl];
  } else {
    finalArgs = [...PRISMA_ARGS[operation], ...rest];
  }

  // Log to stderr so stdout = SQL only (for --script capture).
  process.stderr.write(`Running: prisma ${finalArgs.join(" ")}\n\n`);

  // Uses `pnpm exec prisma` — never `npx prisma` (AGENTS.md / .clinerules).
  const child = spawnSync("pnpm", ["exec", "prisma", ...finalArgs], {
    stdio: "inherit",
    env: process.env,
    cwd: __dirname + "/..",
  });

  process.exitCode = child.status === null ? 1 : child.status;
}

main();

