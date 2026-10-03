// apps/web/lib/icici/environment.ts
//
// ICICI Bank Payment Gateway — UAT ONLY.
//
// This is THE single production-safety gate for the entire ICICI
// integration. Every initiation / callback / status-verification / refund
// code path MUST call isIciciUatAvailable() (or rely on getIciciConfig(),
// which internally enforces the same gate) before doing anything gateway-
// related. No other file should re-implement this check.
//
// Environment detection deliberately mirrors this repo's EXISTING, reviewed
// convention (see packages/db/lib/db-safety.js's detectEnvironment() and its
// doc comment) rather than inventing a new one:
//
//   1. DATABASE_ENV   (explicit project-specific override, if ever set)
//   2. VERCEL_ENV     (Vercel's own environment marker: production | preview | development)
//   3. NODE_ENV       (production | development | test)
//
// "preview" (Vercel preview deployments) is treated as staging-equivalent,
// never production — same as the existing db-safety convention.
//
// CRITICAL: an UNKNOWN/unset environment is treated as "development", NOT as
// "uat" and NOT as "production" — ICICI is only ever available when the
// environment resolves to the explicit "uat" value (see below), so an
// ambiguous environment fails closed to "unavailable", never to "available".
export type BuildohubEnvironment = "production" | "staging" | "uat" | "development" | "test";

function detectEnvironment(env: NodeJS.ProcessEnv = process.env): BuildohubEnvironment {
  // Buildohub-specific explicit override: lets the UAT deployment
  // (https://uat.buildohub.in) declare itself unambiguously as "uat" without
  // relying on VERCEL_ENV, which Vercel itself only ever sets to
  // production | preview | development (it has no native "uat" concept).
  // This MUST be set to "uat" in the UAT deployment's environment variables
  // for ICICI to ever be available there — see docs/payments/icici-uat.md.
  const candidates = [env.DATABASE_ENV, env.BUILDOHUB_ENV, env.VERCEL_ENV, env.NODE_ENV];
  for (const raw of candidates) {
    if (!raw) continue;
    const value = String(raw).toLowerCase();
    if (value === "production") return "production";
    if (value === "uat") return "uat";
    if (value === "staging") return "staging";
    if (value === "preview") return "staging";
    if (value === "test") return "test";
    if (value === "development") return "development";
  }
  return "development";
}

/**
 * The ONLY function that decides whether ICICI payment functionality may run
 * at all. Returns true if and only if:
 *   - the resolved environment is explicitly "uat", AND
 *   - ICICI_PG_ENABLED="true" is explicitly set.
 *
 * Both conditions are required — simply copying ICICI_PG_ENABLED="true" into
 * a production environment's variables does NOT enable ICICI there, because
 * the environment check independently fails closed. This directly satisfies
 * the task's "Production + UAT credentials accidentally present = ICICI
 * still unavailable" requirement.
 */
export function isIciciUatAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const environment = detectEnvironment(env);
  if (environment !== "uat") return false;
  return String(env.ICICI_PG_ENABLED || "").toLowerCase() === "true";
}

export function getBuildohubEnvironment(env: NodeJS.ProcessEnv = process.env): BuildohubEnvironment {
  return detectEnvironment(env);
}

// Exported for tests only.
export { detectEnvironment as __detectEnvironmentForTests };
