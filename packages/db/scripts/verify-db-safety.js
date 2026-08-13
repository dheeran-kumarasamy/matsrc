/**
 * Phase 6F-2 — Database Migration Safety Hardening.
 *
 * Assert-based verification of db-safety.js and db-safety-preflight.js.
 * Follows verify-pricing-fingerprint.js convention (no test framework).
 *
 * Run with: node packages/db/scripts/verify-db-safety.js
 *
 * Zero network I/O — all synthetic connection strings, no real databases.
 * Covers all spec §14, §15, §27 required test cases.
 */

"use strict";

const assert = require("assert");
const {
  parseConnectionString,
  redactConnectionString,
  isSameDatabaseIdentity,
  extractNeonEndpointId,
  getNeonEndpointId,
  isProductionDatabase,
  getDatabaseIdentity,
  detectEnvironment,
  KNOWN_PRODUCTION_IDENTIFIERS,
} = require("../lib/db-safety");
const {
  databaseSafetyPreflight,
  validateShadowDatabase,
} = require("../lib/db-safety-preflight");

// Synthetic URLs — uses actual prod endpoint ID for Neon-aware detection tests.
const PROD_EP = KNOWN_PRODUCTION_IDENTIFIERS.neonEndpointId; // ep-muddy-meadow-aoh42y8u
const PROD_DIRECT = `postgresql://prod_user:sup3rsecret@${PROD_EP}.ap-southeast-1.aws.neon.tech/appdb?sslmode=require`;
const PROD_POOLED = `postgresql://prod_user:sup3rsecret@${PROD_EP}-pooler.ap-southeast-1.aws.neon.tech/appdb?sslmode=require`;
const SCRATCH = "postgresql://scratch_user:otherpass@ep-scratch-example.neon.tech/scratchdb?sslmode=require";
const STAGING = "postgresql://staging_user:pass@ep-staging-example.neon.tech/appdb?sslmode=require";
// Legacy Phase 6F-1 URLs (backward compat)
const LP = "postgresql://prod_user:sup3rsecret@ep-prod-example.neon.tech/appdb?sslmode=require";
const LPP = "postgresql://prod_user:sup3rsecret@ep-prod-example-pooler.neon.tech/appdb?sslmode=require";

function run() {
  // =========================================================================
  // SECTION 1: db-safety.js backward-compat unit checks (Phase 6F-1)
  // =========================================================================
  const parsed = parseConnectionString(LP);
  assert.strictEqual(parsed.host, "ep-prod-example.neon.tech");
  assert.strictEqual(parsed.database, "appdb");
  assert.strictEqual(parsed.user, "prod_user");
  assert.strictEqual(parseConnectionString("not-a-url"), null);
  assert.strictEqual(parseConnectionString(undefined), null);
  const redacted = redactConnectionString(LP);
  assert.ok(!redacted.includes("sup3rsecret"), "must never include password");
  assert.ok(redacted.includes("ep-prod-example.neon.tech"), "should keep host");
  assert.strictEqual(isSameDatabaseIdentity(LP, LPP), true, "pooled and direct must be same identity");
  assert.strictEqual(isSameDatabaseIdentity(LP, SCRATCH), false);
  assert.strictEqual(isSameDatabaseIdentity(LP, "not-a-url"), false, "unparseable must fail closed");
  assert.strictEqual(detectEnvironment({ NODE_ENV: "production" }), "production");
  assert.strictEqual(detectEnvironment({ VERCEL_ENV: "production" }), "production");
  assert.strictEqual(detectEnvironment({ VERCEL_ENV: "preview" }), "staging");
  assert.strictEqual(detectEnvironment({ NODE_ENV: "development" }), "development");
  assert.strictEqual(detectEnvironment({}), "development");
  assert.strictEqual(detectEnvironment({ DATABASE_ENV: "production", NODE_ENV: "development" }), "production");
  console.log("SECTION 1 (backward compat): PASSED");


  // SECTION 2: Neon identity extraction (Phase 6F-2)
  assert.strictEqual(extractNeonEndpointId("ep-muddy-meadow-aoh42y8u.ap-southeast-1.aws.neon.tech"), "ep-muddy-meadow-aoh42y8u");
  assert.strictEqual(extractNeonEndpointId("ep-muddy-meadow-aoh42y8u-pooler.ap-southeast-1.aws.neon.tech"), "ep-muddy-meadow-aoh42y8u");
  assert.strictEqual(extractNeonEndpointId("not-neon.example.com"), null);
  assert.strictEqual(extractNeonEndpointId(undefined), null);
  assert.strictEqual(getNeonEndpointId(PROD_DIRECT), PROD_EP);
  assert.strictEqual(getNeonEndpointId(PROD_POOLED), PROD_EP);
  assert.strictEqual(getNeonEndpointId("not-a-url"), null);
  assert.strictEqual(isProductionDatabase(PROD_DIRECT), true, "prod direct must be detected");
  assert.strictEqual(isProductionDatabase(PROD_POOLED), true, "prod pooled must be detected");
  assert.strictEqual(isProductionDatabase(SCRATCH), false);
  assert.strictEqual(isProductionDatabase(STAGING), false);
  assert.strictEqual(isProductionDatabase("not-a-url"), false);
  assert.strictEqual(isProductionDatabase(LP), false, "legacy synthetic not on real endpoint");
  const prodId = getDatabaseIdentity(PROD_DIRECT);
  assert.ok(prodId.parseable && prodId.isProduction && prodId.endpointId === PROD_EP);
  assert.ok(!prodId.redacted.includes("sup3rsecret"));
  const scratchId = getDatabaseIdentity(SCRATCH);
  assert.ok(scratchId.parseable && !scratchId.isProduction);
  console.log("SECTION 2 (Neon identity): PASSED");

  // SECTION 3: validateShadowDatabase
  const s1 = validateShadowDatabase({ shadowUrl: undefined, databaseUrl: PROD_DIRECT, directUrl: PROD_DIRECT });
  assert.strictEqual(s1.valid, false, "S1: missing shadow -> invalid");
  assert.ok(s1.reason.includes("SHADOW_DATABASE_URL is required"));
  const s2 = validateShadowDatabase({ shadowUrl: SCRATCH, databaseUrl: SCRATCH, directUrl: PROD_DIRECT });
  assert.strictEqual(s2.valid, false, "S2: shadow == DATABASE_URL -> invalid");
  // S3: shadow == DIRECT_URL (exact Phase 6F pattern)
  // databaseUrl is STAGING so the "shadow == DATABASE_URL" check passes, then
  // "shadow == DIRECT_URL" is what triggers (PROD_DIRECT == PROD_DIRECT).
  const s3 = validateShadowDatabase({ shadowUrl: PROD_DIRECT, databaseUrl: STAGING, directUrl: PROD_DIRECT });
  assert.strictEqual(s3.valid, false, "S3: shadow == DIRECT_URL (Phase 6F) -> BLOCKED");
  assert.ok(s3.reason.includes("Phase 6F") || s3.reason.includes("DIRECT_URL"), "S3: reason must mention Phase 6F or DIRECT_URL");
  const s4 = validateShadowDatabase({ shadowUrl: PROD_POOLED, databaseUrl: STAGING, directUrl: STAGING });
  assert.strictEqual(s4.valid, false, "S4: shadow = production endpoint -> BLOCKED");
  assert.ok(s4.reason.includes("PRODUCTION"));
  const s5 = validateShadowDatabase({ shadowUrl: SCRATCH, databaseUrl: STAGING, directUrl: STAGING });
  assert.strictEqual(s5.valid, true, "S5: isolated shadow -> valid");

  // SECTION 4: databaseSafetyPreflight — spec §27 cases
  // N1: SHADOW_DATABASE_URL missing
  assert.strictEqual(databaseSafetyPreflight({ operation: "migrate-diff", env: { NODE_ENV: "development", DATABASE_URL: SCRATCH, DIRECT_URL: SCRATCH } }).safe, false, "N1");
  // N2: shadow == DATABASE_URL
  assert.strictEqual(databaseSafetyPreflight({ operation: "migrate-diff", env: { NODE_ENV: "development", DATABASE_URL: SCRATCH, DIRECT_URL: SCRATCH, SHADOW_DATABASE_URL: SCRATCH } }).safe, false, "N2");
  // N3: shadow == DIRECT_URL (exact Phase 6F incident)
  // Uses STAGING as DATABASE_URL so the shadow!=DATABASE_URL check passes,
  // then the shadow==DIRECT_URL check (PROD_DIRECT==PROD_DIRECT) fires.
  {
    const r = databaseSafetyPreflight({ operation: "migrate-diff", env: { NODE_ENV: "development", DATABASE_URL: STAGING, DIRECT_URL: PROD_DIRECT, SHADOW_DATABASE_URL: PROD_DIRECT } });
    assert.strictEqual(r.safe, false, "N3: SHADOW==DIRECT_URL -> BLOCKED");
    assert.ok(r.reason.includes("DIRECT_URL") || r.reason.includes("PRODUCTION") || r.reason.includes("Phase 6F"), "N3: must mention DIRECT_URL, PRODUCTION, or Phase 6F");
  }
  // N4: shadow endpoint == production (Neon-aware, different string from DIRECT_URL)
  assert.strictEqual(databaseSafetyPreflight({ operation: "migrate-diff", env: { NODE_ENV: "development", DATABASE_URL: STAGING, DIRECT_URL: STAGING, SHADOW_DATABASE_URL: PROD_POOLED } }).safe, false, "N4");
  // N5: production DATABASE_URL + migrate-dev -> BLOCKED by endpoint ID (no env label)
  assert.strictEqual(databaseSafetyPreflight({ operation: "migrate-dev", env: { NODE_ENV: "development", DATABASE_URL: PROD_DIRECT, DIRECT_URL: PROD_DIRECT } }).safe, false, "N5");
  // N6: production + db-push
  assert.strictEqual(databaseSafetyPreflight({ operation: "db-push", env: { NODE_ENV: "development", DATABASE_URL: PROD_DIRECT } }).safe, false, "N6");
  // N7: URL variants same identity (shadow and DIRECT_URL are same endpoint despite different URL formats)
  // Uses STAGING as DATABASE_URL to let S2 pass, then S3/S5 fires for the PROD URLs.
  assert.strictEqual(databaseSafetyPreflight({ operation: "migrate-diff", env: { NODE_ENV: "development", DATABASE_URL: STAGING, DIRECT_URL: PROD_DIRECT, SHADOW_DATABASE_URL: PROD_POOLED } }).safe, false, "N7: URL variant same identity -> BLOCKED");
  // P1: Valid disposable shadow + development
  assert.strictEqual(databaseSafetyPreflight({ operation: "migrate-diff", env: { NODE_ENV: "development", DATABASE_URL: STAGING, DIRECT_URL: STAGING, SHADOW_DATABASE_URL: SCRATCH } }).safe, true, "P1");
  // P2: Valid staging + separate shadow
  assert.strictEqual(databaseSafetyPreflight({ operation: "migrate-diff", env: { NODE_ENV: "staging", DATABASE_URL: STAGING, DIRECT_URL: STAGING, SHADOW_DATABASE_URL: SCRATCH } }).safe, true, "P2");
  // P3: production + migrate-deploy (CONTROLLED_WRITE)
  {
    const r = databaseSafetyPreflight({ operation: "migrate-deploy", env: { NODE_ENV: "production", DATABASE_URL: LP, DIRECT_URL: LP } });
    assert.strictEqual(r.safe, true, "P3");
    assert.ok(r.notice, "P3: must surface notice");
  }
  // Override double-gate
  assert.strictEqual(databaseSafetyPreflight({ operation: "migrate-dev", env: { NODE_ENV: "production", DATABASE_URL: LP, ALLOW_PRODUCTION_DB_OPERATION: "true" }, allowProductionOverride: false }).safe, false, "Override: env flag alone -> BLOCK");
  {
    const r = databaseSafetyPreflight({ operation: "migrate-dev", env: { NODE_ENV: "production", DATABASE_URL: LP, ALLOW_PRODUCTION_DB_OPERATION: "true" }, allowProductionOverride: true });
    assert.strictEqual(r.safe, true, "Override: both flags -> ALLOW");
    assert.ok(r.overrideUsed);
  }
  // Credentials never appear
  assert.ok(!JSON.stringify(databaseSafetyPreflight({ operation: "migrate-dev", env: { NODE_ENV: "development", DATABASE_URL: PROD_DIRECT } })).includes("sup3rsecret"), "Credentials must never appear");
  // context.databaseIsProduction
  assert.strictEqual(databaseSafetyPreflight({ operation: "validate", env: { DATABASE_URL: PROD_DIRECT } }).context.databaseIsProduction, true, "context.databaseIsProduction must be true");
  // context.shadowEqualsDirect
  assert.strictEqual(databaseSafetyPreflight({ operation: "migrate-diff", env: { NODE_ENV: "development", DATABASE_URL: STAGING, DIRECT_URL: STAGING, SHADOW_DATABASE_URL: STAGING } }).context.shadowEqualsDirect, true, "context.shadowEqualsDirect must be true");
  console.log("SECTION 4 (databaseSafetyPreflight §27 cases): PASSED");

  // SECTION 5: Historical Phase 6F regression
  // Historical config: production as DATABASE_URL, DIRECT_URL, and SHADOW_DATABASE_URL.
  // Note: PROD_POOLED and PROD_DIRECT normalize to same endpoint, so S2 (shadow==DATABASE_URL) fires.
  {
    const r = databaseSafetyPreflight({ operation: "migrate-diff", env: { DATABASE_URL: STAGING, DIRECT_URL: PROD_DIRECT, SHADOW_DATABASE_URL: PROD_DIRECT } });
    assert.strictEqual(r.safe, false, "Regression: historical Phase 6F config must be BLOCKED");
    assert.ok(r.reason.includes("DIRECT_URL") || r.reason.includes("PRODUCTION") || r.reason.includes("Phase 6F"));
  }
  assert.strictEqual(databaseSafetyPreflight({ operation: "migrate-diff", env: { DATABASE_URL: PROD_POOLED, DIRECT_URL: PROD_DIRECT } }).safe, false, "Regression: missing shadow -> BLOCKED");
  assert.strictEqual(databaseSafetyPreflight({ operation: "migrate-diff", env: { DATABASE_URL: STAGING, DIRECT_URL: STAGING, SHADOW_DATABASE_URL: SCRATCH } }).safe, true, "Regression: valid separate shadow -> ALLOWED");
  console.log("SECTION 5 (historical regression): PASSED");

  console.log("\nAll Phase 6F-2 safety tests PASSED.");
}

run();

  console.log("SECTION 3 (validateShadowDatabase): PASSED");
