/**
 * Phase 6F-1 — Database Migration & Production Safety Hardening.
 *
 * Assert-based verification of packages/db/lib/db-safety.js and
 * packages/db/lib/db-safety-preflight.js. Follows the existing
 * verify-pricing-fingerprint.js / verify-pricing-dedupe-hash.js convention
 * (packages/db has no test framework configured). Run with:
 *
 *   node packages/db/scripts/verify-db-safety.js
 *
 * IMPORTANT: every test below uses entirely fabricated/synthetic connection
 * strings (fake hostnames like "prod.example.neon.tech" /
 * "scratch.example.neon.tech") — none of this ever touches a real database,
 * per the explicit "do not use production for testing" requirement. This
 * script performs zero network I/O.
 */

const assert = require("assert");
const {
  parseConnectionString,
  redactConnectionString,
  isSameDatabaseIdentity,
  detectEnvironment,
} = require("../lib/db-safety");
const { databaseSafetyPreflight } = require("../lib/db-safety-preflight");

const PROD_URL = "postgresql://prod_user:sup3rsecret@ep-prod-example.neon.tech/appdb?sslmode=require";
const PROD_POOLED_URL = "postgresql://prod_user:sup3rsecret@ep-prod-example-pooler.neon.tech/appdb?sslmode=require";
const SCRATCH_URL = "postgresql://scratch_user:otherpass@ep-scratch-example.neon.tech/scratchdb?sslmode=require";
const STAGING_URL = "postgresql://staging_user:pass@ep-staging-example.neon.tech/appdb?sslmode=require";

function run() {
  // --- db-safety.js unit checks -------------------------------------------

  const parsed = parseConnectionString(PROD_URL);
  assert.strictEqual(parsed.host, "ep-prod-example.neon.tech");
  assert.strictEqual(parsed.database, "appdb");
  assert.strictEqual(parsed.user, "prod_user");
  assert.strictEqual(parseConnectionString("not-a-url"), null, "garbage input must return null, never throw or guess");
  assert.strictEqual(parseConnectionString(undefined), null, "missing input must return null");

  const redacted = redactConnectionString(PROD_URL);
  assert.ok(!redacted.includes("sup3rsecret"), "redactConnectionString must never include the password");
  assert.ok(redacted.includes("ep-prod-example.neon.tech"), "redactConnectionString should keep the host for identification");

  assert.strictEqual(
    isSameDatabaseIdentity(PROD_URL, PROD_POOLED_URL),
    true,
    "pooled and direct URLs for the SAME Neon project must compare as the same database identity"
  );
  assert.strictEqual(
    isSameDatabaseIdentity(PROD_URL, SCRATCH_URL),
    false,
    "genuinely different databases must not compare as the same identity"
  );
  assert.strictEqual(
    isSameDatabaseIdentity(PROD_URL, "not-a-url"),
    false,
    "an unparseable comparison must never be treated as 'same' (fail closed)"
  );

  assert.strictEqual(detectEnvironment({ NODE_ENV: "production" }), "production");
  assert.strictEqual(detectEnvironment({ VERCEL_ENV: "production" }), "production");
  assert.strictEqual(detectEnvironment({ VERCEL_ENV: "preview" }), "staging");
  assert.strictEqual(detectEnvironment({ NODE_ENV: "development" }), "development");
  assert.strictEqual(detectEnvironment({}), "development", "unset environment must default to development, never production");
  assert.strictEqual(
    detectEnvironment({ DATABASE_ENV: "production", NODE_ENV: "development" }),
    "production",
    "DATABASE_ENV must take precedence when explicitly set"
  );

  console.log("db-safety.js unit checks passed.");

  // --- Test A: development + scratch database -> SAFE ---------------------
  {
    const result = databaseSafetyPreflight({
      operation: "migrate-dev",
      env: { NODE_ENV: "development", DATABASE_URL: SCRATCH_URL, DIRECT_URL: SCRATCH_URL },
    });
    assert.strictEqual(result.safe, true, "Test A: development + scratch DB must be SAFE");
  }

  // --- Test B: development + production DB used as shadow -> BLOCKED ------
  {
    const result = databaseSafetyPreflight({
      operation: "migrate-diff",
      env: {
        NODE_ENV: "development",
        DATABASE_URL: SCRATCH_URL,
        DIRECT_URL: PROD_URL,
        SHADOW_DATABASE_URL: PROD_URL,
      },
    });
    assert.strictEqual(result.safe, false, "Test B: production DB used as shadow must be BLOCKED");
    assert.ok(/shadow database/i.test(result.reason));
  }

  // --- Test C: production environment + destructive dev command -> BLOCKED
  {
    const result = databaseSafetyPreflight({
      operation: "migrate-dev",
      env: { NODE_ENV: "production", DATABASE_URL: PROD_URL, DIRECT_URL: PROD_URL },
    });
    assert.strictEqual(result.safe, false, "Test C: production + migrate-dev must be BLOCKED");
  }

  // --- Test D: production environment + explicitly approved deploy command
  {
    const result = databaseSafetyPreflight({
      operation: "migrate-deploy",
      env: { NODE_ENV: "production", DATABASE_URL: PROD_URL, DIRECT_URL: PROD_URL },
    });
    assert.strictEqual(result.safe, true, "Test D: production + migrate-deploy (CONTROLLED_WRITE) must be ALLOWED");
    assert.ok(result.notice, "Test D: production CONTROLLED_WRITE must surface a notice, not run silently");
  }

  // --- Test E: missing shadow database for migrate-diff -> BLOCKED --------
  {
    const result = databaseSafetyPreflight({
      operation: "migrate-diff",
      env: { NODE_ENV: "development", DATABASE_URL: SCRATCH_URL, DIRECT_URL: SCRATCH_URL },
    });
    assert.strictEqual(result.safe, false, "Test E: migrate-diff with no SHADOW_DATABASE_URL must be BLOCKED");
  }

  // --- Test F: shadow DB same host/database as production -> BLOCKED ------
  {
    const result = databaseSafetyPreflight({
      operation: "migrate-diff",
      env: {
        NODE_ENV: "development",
        DATABASE_URL: PROD_POOLED_URL, // pooled variant of production
        DIRECT_URL: PROD_URL,
        SHADOW_DATABASE_URL: PROD_URL, // same identity as DIRECT_URL, non-pooled
      },
    });
    assert.strictEqual(result.safe, false, "Test F: shadow DB matching production identity must be BLOCKED");
  }

  // --- Test F2: a genuinely isolated shadow DB must be SAFE ----------------
  {
    const result = databaseSafetyPreflight({
      operation: "migrate-diff",
      env: {
        NODE_ENV: "development",
        DATABASE_URL: STAGING_URL,
        DIRECT_URL: STAGING_URL,
        SHADOW_DATABASE_URL: SCRATCH_URL,
      },
    });
    assert.strictEqual(result.safe, true, "Test F2: a genuinely isolated shadow DB must be SAFE");
  }

  // --- Test G: credentials never appear in any preflight output -----------
  {
    const result = databaseSafetyPreflight({
      operation: "migrate-dev",
      env: { NODE_ENV: "development", DATABASE_URL: PROD_URL, DIRECT_URL: PROD_URL },
    });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("sup3rsecret"), "Test G: preflight result must never contain the raw password");
  }

  // --- Additional: production override requires BOTH env flag AND explicit
  // caller opt-in, per spec §10 ("must never be enabled by default").
  {
    const blockedWithoutOptIn = databaseSafetyPreflight({
      operation: "migrate-dev",
      env: { NODE_ENV: "production", DATABASE_URL: PROD_URL, DIRECT_URL: PROD_URL, ALLOW_PRODUCTION_DB_OPERATION: "true" },
      allowProductionOverride: false,
    });
    assert.strictEqual(blockedWithoutOptIn.safe, false, "env flag alone (no caller opt-in) must still BLOCK");

    const allowedWithBoth = databaseSafetyPreflight({
      operation: "migrate-dev",
      env: { NODE_ENV: "production", DATABASE_URL: PROD_URL, DIRECT_URL: PROD_URL, ALLOW_PRODUCTION_DB_OPERATION: "true" },
      allowProductionOverride: true,
    });
    assert.strictEqual(allowedWithBoth.safe, true, "env flag + explicit caller opt-in together must ALLOW");
    assert.ok(allowedWithBoth.overrideUsed, "override usage must be flagged in the result for audit purposes");
  }

  // --- Additional: unknown operation names fail closed (POTENTIALLY_DESTRUCTIVE)
  {
    const result = databaseSafetyPreflight({
      operation: "some-made-up-operation",
      env: { NODE_ENV: "production", DATABASE_URL: PROD_URL, DIRECT_URL: PROD_URL },
    });
    assert.strictEqual(result.safe, false, "an unrecognized operation must fail closed against production");
  }

  console.log("All databaseSafetyPreflight() tests (A-G + overrides) passed.");
}

run();
