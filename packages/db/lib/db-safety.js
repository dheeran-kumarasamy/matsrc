// packages/db/lib/db-safety.js
//
// Phase 6F-2 — Database Migration Safety Hardening (extends Phase 6F-1).
//
// Pure, dependency-free safety logic used by:
//   packages/db/lib/db-safety-preflight.js   — the mandatory safety gate
//   packages/db/scripts/prisma-safe.js        — the wrapper
//   packages/db/scripts/db-identity.js        — read-only diagnostic
//
// This module never opens a database connection itself — it only parses
// connection strings and environment variables.
//
// Phase 6F-2 additions over Phase 6F-1:
//   - Neon endpoint-ID extraction from connection string hostnames
//   - Hard-coded known-production identifiers (endpoint, project, branch)
//   - isProductionDatabase() — multi-signal production detection
//   - getDatabaseIdentity() — unified identity descriptor for display/audit

"use strict";

const { URL } = require("url");

// ---------------------------------------------------------------------------
// Known production identifiers (non-secret — per spec §6 these are infra
// identifiers, not credentials; hard-coding them makes production detection
// independent of environment variables a developer can accidentally mismatch).
//
// Production Neon infrastructure:
//   Project:  bitter-forest-24244420
//   Branch:   br-long-star-ao464t6w  (primary / default production)
//   Endpoint: ep-muddy-meadow-aoh42y8u
//
// IMPORTANT: the PITR evidence branch br-wandering-sea-aokghz6w must NOT be
// deleted and must NOT be used as a shadow database.
// ---------------------------------------------------------------------------
const KNOWN_PRODUCTION_IDENTIFIERS = {
  neonEndpointId: "ep-muddy-meadow-aoh42y8u",
  neonProjectId: "bitter-forest-24244420",
  neonBranchId: "br-long-star-ao464t6w",
};

const KNOWN_PITR_BRANCH_ID = "br-wandering-sea-aokghz6w";

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Parses a Postgres/Neon connection string into its safe identity fields.
 * Returns null for anything that isn't a parseable postgres(ql):// URL —
 * callers must treat "cannot determine identity" as "cannot prove safety",
 * never as "assume safe".
 */
function parseConnectionString(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return null;

  return {
    protocol: parsed.protocol.replace(/:$/, ""),
    // Neon pooled hosts carry a "-pooler" suffix (e.g.
    // "ep-x-pooler.region.aws.neon.tech") for the exact same logical
    // database as the non-pooled "-x.region.aws.neon.tech" DIRECT_URL host.
    // Stripping it here means DATABASE_URL and DIRECT_URL for the SAME
    // Neon project correctly compare as "the same database identity" —
    // which is exactly the case that must be caught (a shadow database must
    // never be the same underlying database via either connection style).
    host: parsed.hostname.replace(/-pooler(?=\.)/, ""),
    rawHost: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname.replace(/^\//, ""),
    user: decodeURIComponent(parsed.username || ""),
  };
}

/**
 * Redacts a connection string for safe logging: keeps protocol/host/port/
 * database/user, strips the password entirely. Never returns the original
 * string. Returns a fixed placeholder for anything unparseable, rather than
 * ever echoing raw unparsed input (which could itself contain a credential).
 */
function redactConnectionString(rawUrl) {
  const identity = parseConnectionString(rawUrl);
  if (!identity) return "<unset-or-unparseable>";
  return `${identity.protocol}://${identity.user || "<no-user>"}@${identity.rawHost}:${identity.port}/${identity.database}`;
}

/**
 * Two connection strings are "the same database identity" if they resolve
 * to the same (host [pooler-normalized], port, database, user). This is
 * intentionally stricter than raw string equality (a pooled and a direct
 * URL for the same Neon project must both be caught) and intentionally
 * host/database/user-based rather than including the password (so a
 * rotated-password URL for the same database still correctly compares as
 * "same identity").
 */
function isSameDatabaseIdentity(urlA, urlB) {
  const a = parseConnectionString(urlA);
  const b = parseConnectionString(urlB);
  if (!a || !b) return false; // cannot prove sameness -> treated as not-provably-same, NOT as safe (see preflight)
  return a.host === b.host && a.port === b.port && a.database === b.database && a.user === b.user;
}

// ---------------------------------------------------------------------------
// Neon identity extraction  (spec §11)
// ---------------------------------------------------------------------------

/**
 * Extracts the Neon endpoint ID from a Neon hostname.
 * Neon hostnames follow the pattern:
 *   ep-<slug>.<region>.aws.neon.tech
 *   ep-<slug>-pooler.<region>.aws.neon.tech  (pooled variant)
 *
 * Returns the endpoint ID string (e.g. "ep-muddy-meadow-aoh42y8u") or null.
 */
function extractNeonEndpointId(hostname) {
  if (!hostname || typeof hostname !== "string") return null;
  if (!hostname.endsWith(".neon.tech")) return null;
  const withoutPooler = hostname.replace(/-pooler(?=\.)/, "");
  const match = withoutPooler.match(/^(ep-[^.]+)\./);
  return match ? match[1] : null;
}

/**
 * Returns the Neon endpoint ID from a raw connection string URL, or null.
 */
function getNeonEndpointId(rawUrl) {
  const identity = parseConnectionString(rawUrl);
  if (!identity) return null;
  return extractNeonEndpointId(identity.rawHost);
}

// ---------------------------------------------------------------------------
// Production database detection  (spec §6, §11)
// ---------------------------------------------------------------------------

/**
 * Returns true if the given connection URL resolves to the production database
 * by ANY of the following signals:
 *
 *   1. The Neon endpoint ID embedded in the hostname matches the hard-coded
 *      known production endpoint.
 *   2. The Neon endpoint ID matches env PRODUCTION_NEON_ENDPOINT_ID override.
 *   3. The raw hostname starts with the known production endpoint ID prefix
 *      (catches pooled and non-pooled variants).
 *   4. env PRODUCTION_NEON_ENDPOINT_ID matches hostname prefix.
 *
 * Returns false when the URL cannot be parsed — callers must NOT treat
 * false as "definitely not production" in that case; treat it as
 * "cannot verify safety" instead.
 *
 * @param {string} rawUrl
 * @param {object} [env]
 */
function isProductionDatabase(rawUrl, env) {
  const identity = parseConnectionString(rawUrl);
  if (!identity) return false;

  const endpointId = extractNeonEndpointId(identity.rawHost);
  const resolvedEnv = env || {};

  // Signal 1: hard-coded known production endpoint ID
  if (endpointId && endpointId === KNOWN_PRODUCTION_IDENTIFIERS.neonEndpointId) {
    return true;
  }

  // Signal 2: env-declared production endpoint ID override
  const declaredEndpoint = resolvedEnv.PRODUCTION_NEON_ENDPOINT_ID;
  if (declaredEndpoint && endpointId && endpointId === declaredEndpoint) {
    return true;
  }

  // Signal 3: hostname prefix match (catches minor hostname variations)
  if (
    identity.rawHost &&
    (identity.rawHost.startsWith(`${KNOWN_PRODUCTION_IDENTIFIERS.neonEndpointId}.`) ||
      identity.rawHost.startsWith(`${KNOWN_PRODUCTION_IDENTIFIERS.neonEndpointId}-pooler.`))
  ) {
    return true;
  }

  // Signal 4: env-declared endpoint against hostname prefix
  if (declaredEndpoint && identity.rawHost && identity.rawHost.startsWith(declaredEndpoint)) {
    return true;
  }

  return false;
}

/**
 * Returns a structured identity descriptor for display/audit (no passwords).
 *
 * @param {string} rawUrl
 * @param {object} [env]
 * @returns {{ redacted: string, endpointId: string|null, isProduction: boolean, parseable: boolean }}
 */
function getDatabaseIdentity(rawUrl, env) {
  const identity = parseConnectionString(rawUrl);
  if (!identity) {
    return {
      redacted: "<unset-or-unparseable>",
      endpointId: null,
      isProduction: false,
      parseable: false,
    };
  }
  return {
    redacted: redactConnectionString(rawUrl),
    endpointId: extractNeonEndpointId(identity.rawHost),
    isProduction: isProductionDatabase(rawUrl, env),
    parseable: true,
  };
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/**
 * Environment detection. Precedence (most to least specific), matching the
 * project's existing signals (NODE_ENV is already used throughout
 * apps/api and apps/web — see whatsapp-alert-config.service.ts and
 * packages/db/index.ts):
 *
 *   1. DATABASE_ENV        (explicit project-specific override, if ever set)
 *   2. VERCEL_ENV          (Vercel's own environment marker: production |
 *                            preview | development)
 *   3. NODE_ENV            (production | development | test)
 *
 * Defaults to "development" when nothing is set — this repo's existing
 * convention already treats an unset NODE_ENV as development (see
 * `if (process.env.NODE_ENV !== "production")` guards in packages/db/index.ts
 * and apps/web/lib/prisma.ts). Never defaults to "production": an unknown
 * environment must never accidentally be treated as safe-for-destructive-ops
 * OR as production-locked-down — it is surfaced as "development" and the
 * database-identity check (below) is what actually gates destructive
 * production database access, not the environment label alone.
 */
function detectEnvironment(env = process.env) {
  const candidates = [env.DATABASE_ENV, env.VERCEL_ENV, env.NODE_ENV];
  for (const raw of candidates) {
    if (!raw) continue;
    const value = String(raw).toLowerCase();
    if (value === "production") return "production";
    if (value === "staging") return "staging";
    if (value === "preview") return "staging"; // Vercel preview deployments are staging-equivalent, never production
    if (value === "test") return "test";
    if (value === "development") return "development";
  }
  return "development";
}

module.exports = {
  parseConnectionString,
  redactConnectionString,
  isSameDatabaseIdentity,
  extractNeonEndpointId,
  getNeonEndpointId,
  isProductionDatabase,
  getDatabaseIdentity,
  detectEnvironment,
  KNOWN_PRODUCTION_IDENTIFIERS,
  KNOWN_PITR_BRANCH_ID,
};
