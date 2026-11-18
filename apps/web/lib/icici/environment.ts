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
// FAIL-CLOSED ENVIRONMENT POLICY:
// 1. Database environment variables (DATABASE_ENV) must NEVER independently
//    authorise payment gateway operations.
// 2. Preview deployments (VERCEL_ENV=preview) must NEVER enable ICICI operations
//    merely because DATABASE_ENV=uat or BUILDOHUB_ENV=uat.
// 3. Production deployments (VERCEL_ENV=production or NODE_ENV=production without
//    an authorized UAT runtime) must NEVER activate UAT payment operations.
// 4. Local development and automated tests default to disabled.
// 5. Only an explicitly authorised UAT runtime (BUILDOHUB_ENV=uat, not preview,
//    not production, with matching configuration) may enable payment operations.
// 6. Conflicting, missing, or ambiguous configuration fails closed immediately.
// 1. Production deployments (VERCEL_ENV=production, BUILDOHUB_ENV=production,
//    or NODE_ENV=production without an authorized UAT runtime) must NEVER
//    activate UAT payment operations.
// 2. Database environment variables (DATABASE_ENV=production) must strictly
//    fail closed.
// 3. Generic preview deployments (e.g. feature PR branches) default to disabled.
// 4. Authorized UAT runtime is identified by:
//    - Branch is "uat" (VERCEL_GIT_COMMIT_REF === "uat"), OR
//    - BUILDOHUB_ENV is "uat", OR
//    - ICICI_PG_ENV is "uat", OR
//    - NEXT_PUBLIC_SITE_URL includes "uat.buildohub.in"
// 5. Explicit master switch (ICICI_PG_ENABLED):
//    - If set to "false", ICICI is disabled.
//    - If set to "true", ICICI is enabled on UAT.
//    - If unset on authorized UAT deployment (e.g. VERCEL_GIT_COMMIT_REF === "uat" or NEXT_PUBLIC_SITE_URL includes "uat.buildohub.in"), defaults to enabled.

export type BuildohubEnvironment = "production" | "staging" | "uat" | "development" | "test";

function detectEnvironment(env: NodeJS.ProcessEnv = process.env): BuildohubEnvironment {
  // Guard: Vercel preview deployments are strictly staging/preview, NEVER uat or production
  if (env.VERCEL_ENV === "preview") {
    return "staging";
  }

  // Guard: Vercel production deployments are strictly production
  if (env.VERCEL_ENV === "production") {
  // Guard 1: Explicit production in VERCEL_ENV, BUILDOHUB_ENV, or DATABASE_ENV is strictly production
  if (
    env.VERCEL_ENV === "production" ||
    (env.BUILDOHUB_ENV && env.BUILDOHUB_ENV.toLowerCase() === "production") ||
    (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() === "production")
  ) {
    return "production";
  }

  // Explicit BUILDOHUB_ENV takes precedence for defining application runtime identity
  // Guard 2: Explicit UAT runtime detection
  const isUatBranch = env.VERCEL_GIT_COMMIT_REF === "uat";
  const buildohubEnv = (env.BUILDOHUB_ENV || "").toLowerCase();
  if (buildohubEnv === "uat") {
    // Conflicting configuration check: if DATABASE_ENV is explicitly set to something other than uat,
    // fail closed to development so UAT payment operations are denied.
    if (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() !== "uat") {
  const iciciPgEnv = (env.ICICI_PG_ENV || "").toLowerCase();
  const isUatSite = Boolean(env.NEXT_PUBLIC_SITE_URL && env.NEXT_PUBLIC_SITE_URL.includes("uat.buildohub.in"));

  if (isUatBranch || buildohubEnv === "uat" || iciciPgEnv === "uat" || isUatSite) {
    // Conflicting configuration check: if DATABASE_ENV is explicitly set to production or something conflicting, fail closed
    if (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() !== "uat" && env.DATABASE_ENV.toLowerCase() !== "development") {
      return "development";
    }
    return "uat";
  }

  if (buildohubEnv === "production") return "production";
  // Guard 3: Vercel preview deployments (not on uat branch) are staging
  if (env.VERCEL_ENV === "preview") {
    return "staging";
  }

  if (buildohubEnv === "staging") return "staging";
  if (buildohubEnv === "test") return "test";
  if (buildohubEnv === "development") return "development";

  // Fallback to NODE_ENV
  const nodeEnv = (env.NODE_ENV || "").toLowerCase();
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "test";

  return "development";
}

/**
 * The ONLY function that decides whether ICICI payment functionality may run at all.
 * Returns true if and only if all fail-closed criteria are satisfied:
 *   - BUILDOHUB_ENV is explicitly "uat"
 *   - VERCEL_ENV is NOT "preview" and NOT "production"
 *   - The detected environment is explicitly "uat"
 *   - VERCEL_ENV is NOT "production"
 *   - DATABASE_ENV does not conflict with UAT
 *   - The resolved environment is explicitly "uat"
 *   - ICICI_PG_ENABLED="true" is explicitly set
 *   - Master switch: ICICI_PG_ENABLED is NOT "false", and if unset, defaults to true on UAT branch / uat domain
 */
export function isIciciUatAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  // 1. Database environment variables must NEVER independently authorise payment operations.
  const buildohubEnv = (env.BUILDOHUB_ENV || "").toLowerCase();
  if (buildohubEnv !== "uat") {
  // 1. Production deployments must NEVER enable ICICI operations
  if (
    env.VERCEL_ENV === "production" ||
    (env.BUILDOHUB_ENV && env.BUILDOHUB_ENV.toLowerCase() === "production") ||
    (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() === "production")
  ) {
    return false;
  }

  // 2. Preview deployments must NOT enable ICICI operations
  if (env.VERCEL_ENV === "preview") {
  // 2. Conflicting database configuration check
  if (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() !== "uat" && env.DATABASE_ENV.toLowerCase() !== "development") {
    return false;
  }

  // 3. Production deployments must NOT enable ICICI operations
  if (env.VERCEL_ENV === "production") {
  // 3. Environment detection check
  const environment = detectEnvironment(env);
  if (environment !== "uat") {
    return false;
  }

  // 4. Conflicting configuration check (e.g. DATABASE_ENV !== "uat")
  if (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() !== "uat") {
    return false;
  // 4. Master switch check:
  // If explicitly configured, respect ICICI_PG_ENABLED ("true" | "false")
  if (env.ICICI_PG_ENABLED !== undefined) {
    return String(env.ICICI_PG_ENABLED).toLowerCase() === "true";
  }

  // 5. Environment detection check
  const environment = detectEnvironment(env);
  if (environment !== "uat") {
    return false;
  }
  // If ICICI_PG_ENABLED is unset:
  // Automatically enable on authorized UAT deployments (branch=uat or site contains uat.buildohub.in or ICICI_PG_ENV=uat)
  const isAuthorizedUat =
    env.VERCEL_GIT_COMMIT_REF === "uat" ||
    Boolean(env.NEXT_PUBLIC_SITE_URL && env.NEXT_PUBLIC_SITE_URL.includes("uat.buildohub.in")) ||
    (env.ICICI_PG_ENV || "").toLowerCase() === "uat";

  // 6. Explicit master switch
  return String(env.ICICI_PG_ENABLED || "").toLowerCase() === "true";
  return isAuthorizedUat;
}

export function getBuildohubEnvironment(env: NodeJS.ProcessEnv = process.env): BuildohubEnvironment {
  return detectEnvironment(env);
}

// Exported for tests only.
export { detectEnvironment as __detectEnvironmentForTests };
