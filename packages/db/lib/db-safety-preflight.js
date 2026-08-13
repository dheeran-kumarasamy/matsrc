// packages/db/lib/db-safety-preflight.js
//
// Phase 6F-2 — Database Migration Safety Hardening (extends Phase 6F-1).
//
// databaseSafetyPreflight(): the single reusable safety gate every
// destructive/potentially-destructive database operation in this repo MUST
// pass through before Prisma is invoked.
//
// Phase 6F-2 additions over Phase 6F-1:
//   - SHADOW_DATABASE_URL unconditionally MANDATORY for migrate-diff (no fallback).
//   - Production identity checked via isProductionDatabase() (Neon endpoint-ID).
//   - Shadow DB tested against isProductionDatabase(), not only string equality.
//   - validateShadowDatabase() exported as first-class function.
//   - assertSafeMigrationEnvironment() throw-or-continue entrypoint.

"use strict";

const {
  parseConnectionString,
  redactConnectionString,
  isSameDatabaseIdentity,
  isProductionDatabase,
  detectEnvironment,
} = require("./db-safety");

/**
 * Operation classification — every operation this repo's wrapper can invoke.
 * An unrecognized operation name is treated as POTENTIALLY_DESTRUCTIVE
 * (fail closed, never fail open).
 */
const OPERATION_CLASS = {
  generate: "READ_ONLY",
  validate: "READ_ONLY",
  format: "READ_ONLY",
  studio: "CONTROLLED_WRITE",
  "migrate-deploy": "CONTROLLED_WRITE",
  "db-execute": "CONTROLLED_WRITE",
  "migrate-dev": "POTENTIALLY_DESTRUCTIVE",
  "migrate-reset": "POTENTIALLY_DESTRUCTIVE",
  "migrate-diff": "POTENTIALLY_DESTRUCTIVE", // exact command from Phase 6F incident
  "db-push": "POTENTIALLY_DESTRUCTIVE",
  "db-seed": "POTENTIALLY_DESTRUCTIVE",
};

function classifyOperation(operation) {
  return OPERATION_CLASS[operation] || "POTENTIALLY_DESTRUCTIVE";
}

// ---------------------------------------------------------------------------
// validateShadowDatabase  (spec §5, §7, §8, §11)
// ---------------------------------------------------------------------------

/**
 * Validates SHADOW_DATABASE_URL is set, parseable, distinct from
 * DATABASE_URL/DIRECT_URL, and NOT the production database.
 * FAIL-CLOSED: every uncertain case → blocked.
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
function validateShadowDatabase({ shadowUrl, databaseUrl, directUrl, env }) {
  if (!shadowUrl) {
    return {
      valid: false,
      reason:
        "BLOCKED: SHADOW_DATABASE_URL is required for migrate-diff operations.\n\n" +
        "Set SHADOW_DATABASE_URL to a genuinely isolated, disposable database.\n" +
        "NEVER use DIRECT_URL as SHADOW_DATABASE_URL — that caused the Phase 6F incident.",
    };
  }
  if (!parseConnectionString(shadowUrl)) {
    return {
      valid: false,
      reason: "BLOCKED: SHADOW_DATABASE_URL is set but is not a parseable postgres(ql):// connection string.",
    };
  }
  if (databaseUrl && isSameDatabaseIdentity(shadowUrl, databaseUrl)) {
    return {
      valid: false,
      reason:
        "BLOCKED: SHADOW_DATABASE_URL resolves to the same database identity as DATABASE_URL.\n" +
        `Shadow:   ${redactConnectionString(shadowUrl)}\n` +
        `DATABASE: ${redactConnectionString(databaseUrl)}\n\nUse an isolated scratch/shadow database.`,
    };
  }
  if (directUrl && isSameDatabaseIdentity(shadowUrl, directUrl)) {
    return {
      valid: false,
      reason:
        "BLOCKED: SHADOW_DATABASE_URL resolves to the same database identity as DIRECT_URL.\n\n" +
        "This is the exact pattern that caused the Phase 6F production data-loss incident.\n" +
        "See docs/database/phase-6f-1-safety-hardening-report.md.\n\n" +
        `Shadow:     ${redactConnectionString(shadowUrl)}\n` +
        `DIRECT_URL: ${redactConnectionString(directUrl)}\n\nNever use DIRECT_URL as a shadow database.`,
    };
  }
  if (isProductionDatabase(shadowUrl, env)) {
    return {
      valid: false,
      reason:
        "BLOCKED: SHADOW_DATABASE_URL resolves to the PRODUCTION Neon endpoint.\n\n" +
        `Shadow: ${redactConnectionString(shadowUrl)}\n\n` +
        "Production must never be used as a Prisma shadow database — Prisma resets it destructively.",
    };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Main preflight  (spec §7, §18)
// ---------------------------------------------------------------------------

/**
 * Runs the full safety preflight for a requested operation.
 *
 * @param {object} input
 * @param {string} input.operation
 * @param {object} [input.env] - defaults to process.env; overridable for tests.
 * @param {boolean} [input.allowProductionOverride] - requires BOTH this AND
 *   env.ALLOW_PRODUCTION_DB_OPERATION="true" (double-gate).
 */
function databaseSafetyPreflight({ operation, env = process.env, allowProductionOverride = false } = {}) {
  const environment = detectEnvironment(env);
  const operationClass = classifyOperation(operation);

  const databaseUrl = env.DATABASE_URL;
  const directUrl = env.DIRECT_URL;
  const shadowUrl = env.SHADOW_DATABASE_URL;

  const context = {
    environment,
    operation,
    operationClass,
    databaseTarget: redactConnectionString(databaseUrl),
    directTarget: directUrl ? redactConnectionString(directUrl) : null,
    shadowTarget: shadowUrl ? redactConnectionString(shadowUrl) : null,
    databaseIsProduction: databaseUrl ? isProductionDatabase(databaseUrl, env) : false,
    shadowIsProduction: shadowUrl ? isProductionDatabase(shadowUrl, env) : null,
    shadowEqualsDirect: !!(shadowUrl && directUrl && isSameDatabaseIdentity(shadowUrl, directUrl)),
  };

  // Rule 0: no DATABASE_URL -> cannot proceed for non-READ_ONLY.
  if (!parseConnectionString(databaseUrl) && operationClass !== "READ_ONLY") {
    return blocked(
      context,
      "DATABASE_URL is not set or is not a parseable postgres(ql):// connection string. Refusing to proceed."
    );
  }

  // Rule 1: migrate-diff requires a valid, isolated SHADOW_DATABASE_URL.
  // NO fallback to DIRECT_URL — ever. (spec §8)
  if (operation === "migrate-diff") {
    const shadowCheck = validateShadowDatabase({ shadowUrl, databaseUrl, directUrl, env });
    if (!shadowCheck.valid) {
      return blocked(context, shadowCheck.reason);
    }
  }

  // Rule 2: production + POTENTIALLY_DESTRUCTIVE → BLOCK.
  // Both environment label AND Neon endpoint ID detection used.
  const productionByLabel = environment === "production";
  const productionByEndpoint = databaseUrl ? isProductionDatabase(databaseUrl, env) : false;
  const productionDetected = productionByLabel || productionByEndpoint;

  if (productionDetected && operationClass === "POTENTIALLY_DESTRUCTIVE") {
    if (env.ALLOW_PRODUCTION_DB_OPERATION === "true" && allowProductionOverride) {
      return {
        safe: true,
        overrideUsed: true,
        context,
        warning:
          "ALLOW_PRODUCTION_DB_OPERATION override used for a POTENTIALLY_DESTRUCTIVE operation " +
          `("${operation}") against a production environment. This should be exceedingly rare.`,
      };
    }
    return blocked(
      context,
      `BLOCKED: "${operation}" is classified POTENTIALLY_DESTRUCTIVE and the target database is ` +
        "production (detected by endpoint ID and/or environment label).\n\n" +
        "Potentially destructive Prisma commands must never run against production. " +
        "Use `migrate deploy` or `db execute` with a reviewed migration instead."
    );
  }

  // Rule 3: CONTROLLED_WRITE against production is allowed but surfaced.
  if (productionDetected && operationClass === "CONTROLLED_WRITE") {
    return {
      safe: true,
      context,
      notice: `"${operation}" is a CONTROLLED_WRITE against a production-classified environment. Proceeding requires explicit, reviewed decision.`,
    };
  }

  return { safe: true, context };
}

// ---------------------------------------------------------------------------
// assertSafeMigrationEnvironment  (spec §9)
// ---------------------------------------------------------------------------

/**
 * Throws an Error if databaseSafetyPreflight() returns { safe: false }.
 */
function assertSafeMigrationEnvironment(opts) {
  const result = databaseSafetyPreflight(opts);
  if (!result.safe) {
    throw new Error(result.reason);
  }
  return result;
}

function blocked(context, reason) {
  return { safe: false, context, reason };
}

module.exports = {
  databaseSafetyPreflight,
  validateShadowDatabase,
  assertSafeMigrationEnvironment,
  classifyOperation,
  OPERATION_CLASS,
};
