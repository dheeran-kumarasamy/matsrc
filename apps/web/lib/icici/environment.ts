/**
 * Environment resolution for ICICI Payment Gateway operations.
 *
 * Strict fail-closed policy:
 * 1. Production deployments must NEVER enable ICICI operations.
 *    Any environment claiming "production" anywhere (VERCEL_ENV, BUILDOHUB_ENV, DATABASE_ENV)
 *    strictly disables ICICI operations (returns false).
 * 2. Conflicting configurations (e.g. BUILDOHUB_ENV=uat but DATABASE_ENV=production)
 *    fail closed to false.
 * 3. Generic Vercel preview environments (not on the uat branch and not on the uat site)
 *    are categorized as "staging" and fail closed.
 * 4. UAT environment is detected if:
 *    - VERCEL_GIT_COMMIT_REF is "uat", OR
 *    - BUILDOHUB_ENV is "uat", OR
 *    - ICICI_PG_ENV is "uat", OR
 *    - NEXT_PUBLIC_SITE_URL includes "uat.buildohub.in"
 * 5. Explicit master switch (ICICI_PG_ENABLED):
 *    - If set to "false", ICICI is disabled.
 *    - If set to "true", ICICI is enabled on UAT.
 *    - If unset on authorized UAT deployment (e.g. VERCEL_GIT_COMMIT_REF === "uat" or NEXT_PUBLIC_SITE_URL includes "uat.buildohub.in"), defaults to enabled.
 */

export type BuildohubEnvironment = "production" | "staging" | "uat" | "development" | "test";

function detectEnvironment(env: NodeJS.ProcessEnv = process.env): BuildohubEnvironment {
  // Guard 1: Explicit production in VERCEL_ENV, BUILDOHUB_ENV, or DATABASE_ENV is strictly production
  if (
    env.VERCEL_ENV === "production" ||
    (env.BUILDOHUB_ENV && env.BUILDOHUB_ENV.toLowerCase() === "production") ||
    (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() === "production")
  ) {
    return "production";
  }

  const isUatBranch = env.VERCEL_GIT_COMMIT_REF === "uat";
  const isUatSite = Boolean(env.NEXT_PUBLIC_SITE_URL && env.NEXT_PUBLIC_SITE_URL.includes("uat.buildohub.in"));
  const buildohubEnv = (env.BUILDOHUB_ENV || "").toLowerCase();
  const iciciPgEnv = (env.ICICI_PG_ENV || "").toLowerCase();

  // Guard 2: Generic Vercel preview deployments (not on uat branch or uat site) are strictly staging
  if (env.VERCEL_ENV === "preview" && !isUatBranch && !isUatSite) {
    return "staging";
  }

  // Guard 3: Explicit UAT runtime detection
  if (isUatBranch || buildohubEnv === "uat" || iciciPgEnv === "uat" || isUatSite) {
    // Conflicting configuration check: if DATABASE_ENV is explicitly set to production or something conflicting, fail closed
    if (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() !== "uat" && env.DATABASE_ENV.toLowerCase() !== "development") {
      return "development";
    }
    return "uat";
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
 *   - The detected environment is explicitly "uat"
 *   - VERCEL_ENV is NOT "production"
 *   - DATABASE_ENV does not conflict with UAT
 *   - Master switch: ICICI_PG_ENABLED is NOT "false", and if unset, defaults to true on UAT branch / uat domain
 */
export function isIciciUatAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  // 1. Production deployments must NEVER enable ICICI operations
  if (
    env.VERCEL_ENV === "production" ||
    (env.BUILDOHUB_ENV && env.BUILDOHUB_ENV.toLowerCase() === "production") ||
    (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() === "production")
  ) {
    return false;
  }

  // 2. Conflicting database configuration check
  if (env.DATABASE_ENV && env.DATABASE_ENV.toLowerCase() !== "uat" && env.DATABASE_ENV.toLowerCase() !== "development") {
    return false;
  }

  // 3. Environment detection check
  const environment = detectEnvironment(env);
  if (environment !== "uat") {
    return false;
  }

  // 4. Master switch check:
  // If explicitly configured, respect ICICI_PG_ENABLED ("true" | "false")
  if (env.ICICI_PG_ENABLED !== undefined) {
    return String(env.ICICI_PG_ENABLED).toLowerCase() === "true";
  }

  // If ICICI_PG_ENABLED is unset:
  // Automatically enable on authorized UAT deployments (branch=uat or site contains uat.buildohub.in or ICICI_PG_ENV=uat)
  const isAuthorizedUat =
    env.VERCEL_GIT_COMMIT_REF === "uat" ||
    Boolean(env.NEXT_PUBLIC_SITE_URL && env.NEXT_PUBLIC_SITE_URL.includes("uat.buildohub.in")) ||
    env.ICICI_PG_ENV === "uat" ||
    env.BUILDOHUB_ENV === "uat";

  return isAuthorizedUat;
}

export function getBuildohubEnvironment(env: NodeJS.ProcessEnv = process.env): BuildohubEnvironment {
  return detectEnvironment(env);
}

// For testing only
export const __detectEnvironmentForTests = detectEnvironment;
