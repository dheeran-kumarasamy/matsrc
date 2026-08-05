/**
 * Determinism check for computeCanonicalSkuFingerprint (spec §2.3).
 *
 * packages/db has no test framework configured (no vitest/jest here — see
 * scripts/seed-catalog.js and friends for the existing plain-Node script
 * convention), so this is a plain assert-based script rather than a *.spec.ts
 * file. Run with:
 *
 *   node packages/db/scripts/verify-pricing-fingerprint.js
 *
 * Exits non-zero (and prints the failing assertion) if any check fails, so
 * it can be wired into CI the same way as any other node script.
 */

const assert = require("assert");
const {
  computeCanonicalSkuFingerprint,
} = require("../lib/pricing-fingerprint");

function run() {
  // 1. Same input -> same fingerprint, called repeatedly.
  const input = {
    materialCategoryId: "cat_tmt_fe500d",
    brandId: "brand_tata",
    grade: "Fe 500D",
    sizeMm: 12,
    sizeLabel: null,
    packLabel: null,
  };
  const fp1 = computeCanonicalSkuFingerprint(input);
  const fp2 = computeCanonicalSkuFingerprint(input);
  const fp3 = computeCanonicalSkuFingerprint({ ...input });
  assert.strictEqual(fp1, fp2, "fingerprint must be deterministic across calls");
  assert.strictEqual(
    fp1,
    fp3,
    "fingerprint must be deterministic across equivalent-but-distinct objects"
  );
  assert.match(fp1, /^[a-f0-9]{64}$/, "fingerprint must be a 64-char hex sha256 digest");

  // 2. Case/whitespace insensitivity — "Fe 500D" vs " fe 500d " must match.
  const fpTrimmedLower = computeCanonicalSkuFingerprint({
    ...input,
    grade: " fe 500d ",
  });
  assert.strictEqual(
    fp1,
    fpTrimmedLower,
    "fingerprint must normalize case and surrounding whitespace"
  );

  // 3. Different grade -> different fingerprint.
  const fpDifferentGrade = computeCanonicalSkuFingerprint({
    ...input,
    grade: "Fe 550",
  });
  assert.notStrictEqual(
    fp1,
    fpDifferentGrade,
    "changing grade must change the fingerprint"
  );

  // 4. Null-vs-empty-string in different positions must not collide.
  //    { grade: null, sizeLabel: "12" } vs { grade: "12", sizeLabel: null }
  const fpA = computeCanonicalSkuFingerprint({
    materialCategoryId: "cat_x",
    brandId: null,
    grade: null,
    sizeMm: null,
    sizeLabel: "12",
    packLabel: null,
  });
  const fpB = computeCanonicalSkuFingerprint({
    materialCategoryId: "cat_x",
    brandId: null,
    grade: "12",
    sizeMm: null,
    sizeLabel: null,
    packLabel: null,
  });
  assert.notStrictEqual(
    fpA,
    fpB,
    "moving a value between fields must not produce the same fingerprint (position must matter)"
  );

  // 5. materialCategoryId is required.
  assert.throws(
    () => computeCanonicalSkuFingerprint({ materialCategoryId: "" }),
    /materialCategoryId/,
    "must throw when materialCategoryId is missing/empty"
  );

  console.log("All pricing fingerprint determinism checks passed.");
}

run();
