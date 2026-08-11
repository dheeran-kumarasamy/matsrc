// packages/db/lib/db-safety.js
//
// Phase 6F-1 — Database Migration & Production Safety Hardening.
//
// Pure, dependency-free safety logic used by packages/db/scripts/prisma-safe.js
// (the wrapper that must be used instead of invoking `prisma` directly for any
// operation that can write to or destroy data) and by
// packages/db/scripts/db-identity.js (the read-only diagnostic).
//
// This module never opens a database connection itself — it only parses
// connection strings and environment variables. Kept as a single
// require()-able CommonJS module (matching the existing packages/db/scripts/*
// convention — no test framework is configured in this package, see
// verify-pricing-fingerprint.js for the established pattern), so it can be
// exercised by a plain assert-based script (verify-db-safety.js) without
// needing any real database.
//
// BACKGROUND (why this file exists): during Phase 6F, a
// `prisma migrate diff --shadow-database-url` invocation was mistakenly run
// against the production DIRECT_URL instead of an isolated scratch database,
// wiping most application data (recovered via Neon Instant Restore — see
// docs/database/phase-6f-1-safety-hardening-report.md). This module's
// central job is to make that specific mistake — and its close relatives —
// structurally difficult to repeat.

const { URL } = require("url");

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
  detectEnvironment,
};
