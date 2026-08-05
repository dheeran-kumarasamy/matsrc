// packages/db/scripts/seed-pricing-endpoints.js
//
// Phase 2 seed script for PricingSourceEndpoint — a small, bounded pilot set
// of crawl targets (NOT a full cross-product of sources x districts x
// categories). See packages/db/prisma/seeds/pricing/source-endpoints.json.
//
// Mirrors the idempotent upsert-by-unique-key pattern and the "refuse to
// seed an enabled row whose parent isn't compliance-clear" guard used by
// scripts/seed-pricing.js:
//   - Every endpoint here is deliberately isEnabled=false, matching the
//     fact that all 15 parent PricingSource rows are currently disabled
//     pending ToS review (see docs/pricing/seed-review-checklist.md).
//   - If an endpoint's `isEnabled: true` were ever added to the seed file,
//     this script refuses to seed it unless the parent source is both
//     isEnabled and tosReviewedAt is non-null — keeping this script
//     consistent with verify-pricing-source-compliance.js.
//
// Usage (from repo root):
//   node packages/db/scripts/seed-pricing-endpoints.js
//
// Requires the pricing_intelligence_module migration + seed-pricing.js to
// have already been run (districts/categories/sources must already exist).

const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const SEEDS_DIR = path.join(__dirname, "..", "prisma", "seeds", "pricing");
const endpoints = require(path.join(SEEDS_DIR, "source-endpoints.json"));

async function main() {
  console.log(`Starting pricing source endpoint seed (${endpoints.length} pilot endpoint(s))...`);

  let created = 0;
  let updated = 0;

  for (const ep of endpoints) {
    const source = await prisma.pricingSource.findUnique({ where: { code: ep.sourceCode } });
    if (!source) {
      throw new Error(
        `Endpoint references unknown sourceCode "${ep.sourceCode}". Seed sources first (seed-pricing.js).`
      );
    }

    let materialCategoryId = null;
    if (ep.materialCategoryCode) {
      const category = await prisma.pricingMaterialCategory.findUnique({
        where: { code: ep.materialCategoryCode },
      });
      if (!category) {
        throw new Error(
          `Endpoint references unknown materialCategoryCode "${ep.materialCategoryCode}". Seed categories first.`
        );
      }
      materialCategoryId = category.id;
    }

    let districtId = null;
    if (ep.districtCode) {
      const district = await prisma.pricingDistrict.findUnique({ where: { code: ep.districtCode } });
      if (!district) {
        throw new Error(
          `Endpoint references unknown districtCode "${ep.districtCode}". Seed districts first.`
        );
      }
      districtId = district.id;
    }

    const isEnabled = !!ep.isEnabled;
    if (isEnabled && !(source.isEnabled && source.tosReviewedAt)) {
      throw new Error(
        `Endpoint for source "${ep.sourceCode}" is isEnabled=true but the parent source is not ` +
          `isEnabled+tosReviewedAt — refusing to seed an enabled endpoint against a non-compliant source.`
      );
    }

    const data = {
      sourceId: source.id,
      districtId,
      materialCategoryId,
      url: ep.url,
      apifyInput: ep.apifyInput ?? null,
      isEnabled,
    };

    const existing = await prisma.pricingSourceEndpoint.findUnique({
      where: { sourceId_url: { sourceId: source.id, url: ep.url } },
    });

    if (existing) {
      await prisma.pricingSourceEndpoint.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.pricingSourceEndpoint.create({ data });
      created++;
    }
  }

  console.log(`Pricing source endpoints: ${created} created, ${updated} updated.`);

  const total = await prisma.pricingSourceEndpoint.count();
  console.log(`\nSeed summary: pricing_source_endpoint total rows = ${total}`);
  console.log(
    "\nAll seeded endpoints are isEnabled=false (parent sources are still pending ToS review). " +
      "See docs/pricing/seed-review-checklist.md."
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
