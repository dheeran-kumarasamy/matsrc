// packages/db/lib/db-safety-preflight.js
//
// Phase 6F-1 — Database Migration & Production Safety Hardening.
//
// databaseSafetyPreflight(): the single reusable safety gate every
// destructive/potentially-destructive database operation in this repo must
// pass through before Prisma (or any other DB client) is actually invoked.
// See docs/database/database-safety.md for the full policy this encodes.
//
// Pure function of (environment variables, requested operation) -> a
// { safe: true } or { safe: false, reason } result. Never opens a database
// connection, never mutates anything, never has side effects beyond reading
// process.env. This is what makes it unit-testable without any real
// database (see verify-db-safety.js).

const {
  parseConnectionString,
  redactConnectionString,
  isSameDatabaseIdentity,
  detectEnvironment,
} = require("./db-safety");

/**
 * Operation classification (see docs/database/database-safety.md §"Safe
 * Prisma commands" / §"Unsafe Prisma command patterns" for the full
 * rationale). Every operation this repo's scripts/wrapper can invoke must
 * appear here — an unrecognized operation name is treated as
 * POTENTIALLY_DESTRUCTIVE (fail closed, never fail open).
 */
const OPERATION_CLASS = {
  generate: "READ_ONLY",
  validate: "READ_ONLY",
  format: "READ_ONLY",
  studio: "CONTROLLED_WRITE", // opens an interactive editor against a real DB; not itself destructive but must not silently target production
  "migrate-deploy": "CONTROLLED_WRITE",
  "db-execute": "CONTROLLED_WRITE",
  "migrate-dev": "POTENTIALLY_DESTRUCTIVE",
  "migrate-reset": "POTENTIALLY_DESTRUCTIVE",
  "migrate-diff": "POTENTIALLY_DESTRUCTIVE", // the exact command involved in the Phase 6F incident
  "db-push": "POTENTIALLY_DESTRUCTIVE",
  "db-seed": "POTENTIALLY_DESTRUCTIVE", // repo's seed scripts are upsert-based, but still write to whatever DATABASE_URL resolves to
};

function classifyOperation(operation) {
  return OPERATION_CLASS[operation] || "POTENTIALLY_DESTRUCTIVE";
}

/**
 * Runs the safety preflight for a requested operation.
 *
 * @param {object} input
 * @param {string} input.operation - one of the OPERATION_CLASS keys.
 * @param {object} [input.env] - defaults to process.env; overridable for tests.
 * @param {boolean} [input.allowProductionOverride] - only meaningful when the
 *   caller has also set env.ALLOW_PRODUCTION_DB_OPERATION="true" (see
 *   docs/database/database-safety.md §"Emergency procedure"). Both must be
 *   true for an override to take effect — a code-level flag alone is never
 *   sufficient, matching spec §10 ("must never be enabled by default").
 */
function databaseSafetyPreflight({ operation, env = process.env, allowProductionOverride = false } = {}) {
  const environment = detectEnvironment(env);
  const operationClass = classifyOperation(operation);

  const databaseUrl = env.DATABASE_URL;
  const directUrl = env.DIRECT_URL;
  const shadowUrl = env.SHADOW_DATABASE_URL;

  const databaseIdentity = parseConnectionString(databaseUrl);
  const directIdentity = parseConnectionString(directUrl);

  const context = {
    environment,
    operation,
    operationClass,
    databaseTarget: redactConnectionString(databaseUrl),
    directTarget: directUrl ? redactConnectionString(directUrl) : null,
    shadowTarget: shadowUrl ? redactConnectionString(shadowUrl) : null,
  };

  // Rule 0: no DATABASE_URL at all -> cannot proceed safely for anything
  // beyond READ_ONLY (generate/validate/format do not need a live DB).
  if (!databaseIdentity && operationClass !== "READ_ONLY") {
    return blocked(
      context,
      "DATABASE_URL is not set or is not a parseable postgres(ql):// connection string. Refusing to proceed — cannot verify this is not production."
    );
  }

  // Rule 1 (spec §4 — the core Phase 6F-1 requirement): a production
  // database must NEVER be usable as a Prisma shadow database, whether via
  // an explicit SHADOW_DATABASE_URL or via `--shadow-database-url` pointed
  // at DATABASE_URL/DIRECT_URL. This check applies regardless of the
  // detected `environment` string, because the incident this phase exists
  // to prevent was DATABASE_ENV/NODE_ENV=development locally while the
  // *connection string itself* pointed at production — environment labels
  // alone are not a sufficient signal.
  if (operation === "migrate-diff") {
    if (shadowUrl) {
      if (!parseConnectionString(shadowUrl)) {
        return blocked(context, "SHADOW_DATABASE_URL is set but is not a parseable postgres(ql):// connection string.");
      }
      if (databaseIdentity && isSameDatabaseIdentity(shadowUrl, databaseUrl)) {
        return blocked(
          context,
          "BLOCKED: This operation is attempting to use DATABASE_URL as a Prisma shadow database.\n\n" +
            "Use an isolated scratch/shadow database. No database command was executed."
        );
      }
      if (directIdentity && isSameDatabaseIdentity(shadowUrl, directUrl)) {
        return blocked(
          context,
          "BLOCKED: This operation is attempting to use DIRECT_URL as a Prisma shadow database.\n\n" +
            "This is the exact pattern that caused the Phase 6F production data-loss incident " +
            "(see docs/database/phase-6f-1-safety-hardening-report.md). Use an isolated " +
            "scratch/shadow database instead. No database command was executed."
        );
      }
    } else {
      return blocked(
        context,
        "BLOCKED: `prisma migrate diff --shadow-database-url` requires an explicit, isolated " +
          "SHADOW_DATABASE_URL. Refusing to fall back to DATABASE_URL/DIRECT_URL implicitly. " +
          "No database command was executed."
      );
    }
  }

  // Rule 2 (spec §5/§9): production database + destructive/local operation
  // -> BLOCK, never silently redirect, never continue.
  const productionDetected = environment === "production";
  if (productionDetected && operationClass === "POTENTIALLY_DESTRUCTIVE") {
    if (env.ALLOW_PRODUCTION_DB_OPERATION === "true" && allowProductionOverride) {
      return {
        safe: true,
        overrideUsed: true,
        context,
        warning:
          "ALLOW_PRODUCTION_DB_OPERATION override used for a POTENTIALLY_DESTRUCTIVE operation " +
          `("${operation}") against a production environment. This should be exceedingly rare — ` +
          "see docs/database/database-safety.md §Emergency procedure.",
      };
    }
    return blocked(
      context,
      `BLOCKED: "${operation}" is classified POTENTIALLY_DESTRUCTIVE and the current environment is ` +
        "production.\n\nPotentially destructive local-development Prisma commands (migrate dev, " +
        "migrate reset, db push, migrate diff) must never run against production. Use `migrate deploy` " +
        "or `db execute` with an explicitly reviewed migration instead. No database command was executed."
    );
  }

  // Rule 3: even a CONTROLLED_WRITE against production must be explicit —
  // this does not block it (migrate deploy / db execute are the actual
  // production-safe workflow, see docs/database/database-safety.md), but it
  // is surfaced clearly so it is never accidental.
  if (productionDetected && operationClass === "CONTROLLED_WRITE") {
    return {
      safe: true,
      context,
      notice: `"${operation}" is a CONTROLLED_WRITE operation running against a production-classified environment. Proceeding requires this was an explicit, reviewed decision.`,
    };
  }

  return { safe: true, context };
}

function blocked(context, reason) {
  return { safe: false, context, reason };
}

module.exports = {
  databaseSafetyPreflight,
  classifyOperation,
  OPERATION_CLASS,
};
