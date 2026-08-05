/**
 * Invariant check: no PricingSource may be isEnabled=true without a non-null
 * tosReviewedAt, and no INTERNAL_ONLY source may have publicDisplayAllowed=true
 * on any of its downstream serving-layer rows (see
 * docs/pricing/seed-review-checklist.md "Enforcement reminders for later
 * phases").
 *
 * This queries the actual database (same pattern as scripts/seed-pricing.js),
 * so it must be run after migration + generate + seed. Exits with a non-zero
 * code and prints the offending rows if any violation is found — safe to
 * wire into CI as a standalone node script (packages/db has no vitest/jest
 * configured, see scripts/seed-catalog.js for the existing convention).
 *
 * Usage: node packages/db/scripts/verify-pricing-source-compliance.js
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("Verifying pricing source compliance invariants...");

  let failures = 0;

  // Invariant 1: isEnabled=true => tosReviewedAt must be non-null.
  const enabledWithoutTosReview = await prisma.pricingSource.findMany({
    where: { isEnabled: true, tosReviewedAt: null },
    select: { id: true, code: true, name: true },
  });
  if (enabledWithoutTosReview.length > 0) {
    failures += enabledWithoutTosReview.length;
    console.error(
      `FAIL: ${enabledWithoutTosReview.length} source(s) are isEnabled=true with no tosReviewedAt:`
    );
    for (const s of enabledWithoutTosReview) {
      console.error(`  - ${s.code} (${s.name}) [id=${s.id}]`);
    }
  } else {
    console.log("  OK: no isEnabled source lacks tosReviewedAt.");
  }

  // Invariant 2: INTERNAL_ONLY licenseClass sources must have
  // publicDisplayAllowed=false.
  const internalOnlyPublic = await prisma.pricingSource.findMany({
    where: { licenseClass: "INTERNAL_ONLY", publicDisplayAllowed: true },
    select: { id: true, code: true, name: true },
  });
  if (internalOnlyPublic.length > 0) {
    failures += internalOnlyPublic.length;
    console.error(
      `FAIL: ${internalOnlyPublic.length} INTERNAL_ONLY source(s) have publicDisplayAllowed=true:`
    );
    for (const s of internalOnlyPublic) {
      console.error(`  - ${s.code} (${s.name}) [id=${s.id}]`);
    }
  } else {
    console.log("  OK: no INTERNAL_ONLY source has publicDisplayAllowed=true.");
  }

  // Invariant 3: isEnabled=true => robotsAllowed must be true (per schema
  // comment: "A source with robotsAllowed=false or a null tosReviewedAt must
  // not be scheduled").
  const enabledWithoutRobots = await prisma.pricingSource.findMany({
    where: { isEnabled: true, robotsAllowed: false },
    select: { id: true, code: true, name: true },
  });
  if (enabledWithoutRobots.length > 0) {
    failures += enabledWithoutRobots.length;
    console.error(
      `FAIL: ${enabledWithoutRobots.length} source(s) are isEnabled=true with robotsAllowed=false:`
    );
    for (const s of enabledWithoutRobots) {
      console.error(`  - ${s.code} (${s.name}) [id=${s.id}]`);
    }
  } else {
    console.log("  OK: no isEnabled source has robotsAllowed=false.");
  }

  if (failures > 0) {
    console.error(`\n${failures} compliance violation(s) found.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll pricing source compliance invariants hold.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
