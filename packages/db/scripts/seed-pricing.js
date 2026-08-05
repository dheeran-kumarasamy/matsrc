// packages/db/scripts/seed-pricing.js
//
// One-off seed script for the Matsrc District-Wise Price Intelligence module
// (Phase 1 — schema + seeds only, see docs/pricing/seed-review-checklist.md).
//
// Loads the four static reference JSON files under
// packages/db/prisma/seeds/pricing/ and upserts them into the new pricing_*
// tables via Prisma Client:
//   - districts.json           -> PricingDistrict
//   - categories.json          -> PricingMaterialCategory (parent + children)
//   - unit-conversions.json    -> PricingUnitConversion
//   - sources.json             -> PricingSource
//
// Idempotent: uses upsert-by-unique-field throughout, so re-running this
// script will not create duplicate rows.
//
// IMPORTANT — "never fabricate" policy:
//   Several seed rows intentionally carry unverifiable fields as `null`
//   (district lat/long, category GST%/HSN/floor/ceiling, some source
//   baseUrls). This script does NOT invent values for these — it persists
//   the nulls as-is. See docs/pricing/seed-review-checklist.md for the full
//   list of what still needs human verification before those rows can be
//   trusted downstream.
//
// Usage (from repo root):
//   node packages/db/scripts/seed-pricing.js
//
// Requires DATABASE_URL / DIRECT_URL to be set in the environment (see
// packages/db/.env). Must be run AFTER the pricing_intelligence_module
// migration has been applied and `pnpm --filter @matsrc/db db:generate`
// has been run (so PrismaClient knows about the pricing_* models).

const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const SEEDS_DIR = path.join(__dirname, "..", "prisma", "seeds", "pricing");

const districts = require(path.join(SEEDS_DIR, "districts.json"));
const categories = require(path.join(SEEDS_DIR, "categories.json"));
const unitConversions = require(path.join(SEEDS_DIR, "unit-conversions.json"));
const sources = require(path.join(SEEDS_DIR, "sources.json"));

async function seedDistricts() {
  console.log(`\nSeeding ${districts.length} districts...`);
  let created = 0;
  let updated = 0;

  for (const d of districts) {
    const data = {
      code: d.code,
      name: d.name,
      nameTa: d.nameTa ?? null,
      region: d.region ?? null,
      isMetro: !!d.isMetro,
      // Deliberately left null: not yet verified against a defensible
      // source for every district. Do not fabricate.
      latitude: null,
      longitude: null,
      desCentreCode: d.desCentreCode ?? null,
      sorAreaSupplementPct: d.sorAreaSupplementPct ?? null,
      anchorRoadDistanceKm: d.anchorRoadDistanceKm ?? null,
    };

    const existing = await prisma.pricingDistrict.findUnique({ where: { code: d.code } });
    if (existing) {
      await prisma.pricingDistrict.update({ where: { code: d.code }, data });
      updated++;
    } else {
      await prisma.pricingDistrict.create({ data });
      created++;
    }
  }

  console.log(`  Districts: ${created} created, ${updated} updated.`);
}

async function upsertCategory(data) {
  const existing = await prisma.pricingMaterialCategory.findUnique({ where: { code: data.code } });
  if (existing) {
    const row = await prisma.pricingMaterialCategory.update({ where: { code: data.code }, data });
    return { row, wasCreated: false };
  }
  const row = await prisma.pricingMaterialCategory.create({ data });
  return { row, wasCreated: true };
}

async function seedCategories() {
  console.log(`\nSeeding ${categories.length} top-level material categories (with children)...`);
  let created = 0;
  let updated = 0;

  for (const cat of categories) {
    const { row: parent, wasCreated } = await upsertCategory({
      code: cat.code,
      name: cat.name,
      parentId: null,
      baseUnit: cat.baseUnit,
      displayUnit: cat.displayUnit,
      displayLabel: cat.displayLabel ?? null,
      // Deliberately left null: must be sourced from the current CBIC GST
      // rate schedule / HSN classification, not fabricated.
      floorPerBaseUnit: cat.floorPerBaseUnit ?? null,
      ceilingPerBaseUnit: cat.ceilingPerBaseUnit ?? null,
      gstRatePct: cat.gstRatePct ?? null,
      hsnCode: cat.hsnCode ?? null,
    });
    wasCreated ? created++ : updated++;

    for (const child of cat.children ?? []) {
      // Children inherit baseUnit/displayUnit from the parent family, since
      // PricingMaterialCategory.baseUnit/displayUnit are required and the
      // seed spec does not vary them per child (e.g. OPC 43 vs OPC 53 are
      // both sold/priced in the same base unit as Cement).
      const { wasCreated: childCreated } = await upsertCategory({
        code: child.code,
        name: child.name,
        parentId: parent.id,
        baseUnit: parent.baseUnit,
        displayUnit: parent.displayUnit,
        displayLabel: child.displayLabel ?? null,
        floorPerBaseUnit: child.floorPerBaseUnit ?? null,
        ceilingPerBaseUnit: child.ceilingPerBaseUnit ?? null,
        gstRatePct: child.gstRatePct ?? null,
        hsnCode: child.hsnCode ?? null,
      });
      childCreated ? created++ : updated++;
    }
  }

  console.log(`  Categories (incl. children): ${created} created, ${updated} updated.`);
}

async function seedUnitConversions() {
  console.log(`\nSeeding ${unitConversions.length} unit conversion rows...`);
  console.log(
    "  Note: ambiguous rows (e.g. TMT steel rod/bundle, sand tonne/lorry) were intentionally"
  );
  console.log(
    "  omitted from unit-conversions.json per user decision — they cannot be resolved via a"
  );
  console.log("  flat factor and must be handled via SKU nominal weight/volume instead.");

  const categoryIdByCode = new Map();
  for (const row of unitConversions) {
    if (!categoryIdByCode.has(row.materialCategoryCode)) {
      const cat = await prisma.pricingMaterialCategory.findUnique({
        where: { code: row.materialCategoryCode },
      });
      if (!cat) {
        throw new Error(
          `Unit conversion row references unknown materialCategoryCode "${row.materialCategoryCode}". Seed categories first.`
        );
      }
      categoryIdByCode.set(row.materialCategoryCode, cat.id);
    }
  }

  let created = 0;
  let updated = 0;

  for (const row of unitConversions) {
    const materialCategoryId = categoryIdByCode.get(row.materialCategoryCode);
    const data = {
      materialCategoryId,
      fromLabel: row.fromLabel,
      toBaseUnit: row.toBaseUnit,
      factor: row.factor,
      isAmbiguous: !!row.isAmbiguous,
      note: row.note ?? null,
    };

    const existing = await prisma.pricingUnitConversion.findUnique({
      where: {
        materialCategoryId_fromLabel: { materialCategoryId, fromLabel: row.fromLabel },
      },
    });

    if (existing) {
      await prisma.pricingUnitConversion.update({
        where: { id: existing.id },
        data,
      });
      updated++;
    } else {
      await prisma.pricingUnitConversion.create({ data });
      created++;
    }
  }

  console.log(`  Unit conversions: ${created} created, ${updated} updated.`);
}

async function seedSources() {
  console.log(`\nSeeding ${sources.length} pricing sources...`);
  let created = 0;
  let updated = 0;

  for (const s of sources) {
    // `needsVerification` / `verificationNote` are seed-spec-only annotations
    // (not PricingSource schema fields) — surfaced in the seed-review
    // checklist doc, not persisted directly.
    // `tosReviewedAtIsNow` is a marker (not a real field) meaning "this is
    // Matsrc's own data, ToS-reviewed as of now" — translated to an actual
    // Date below.
    const data = {
      code: s.code,
      name: s.name,
      tier: s.tier,
      licenseClass: s.licenseClass,
      scrapeMethod: s.scrapeMethod,
      baseUrl: s.baseUrl ?? null,
      robotsAllowed: !!s.robotsAllowed,
      tosReviewedAt: s.tosReviewedAtIsNow ? new Date() : s.tosReviewedAt ?? null,
      tosReviewNote: s.tosReviewNote ?? null,
      publicDisplayAllowed: !!s.publicDisplayAllowed,
      attributionText: s.attributionText ?? null,
      defaultPriceType: s.defaultPriceType,
      defaultTaxTreatment: s.defaultTaxTreatment ?? "UNKNOWN",
      apifyActorId: s.apifyActorId ?? null,
      apifyTaskId: s.apifyTaskId ?? null,
      cronExpression: s.cronExpression ?? null,
      isEnabled: !!s.isEnabled,
      freshnessSlaHours: s.freshnessSlaHours ?? null,
      trustWeight: s.trustWeight ?? 1.0,
    };

    if (data.isEnabled && !data.tosReviewedAt) {
      throw new Error(
        `Source "${s.code}" is isEnabled=true but has no tosReviewedAt — refusing to seed an enabled source without ToS review.`
      );
    }

    const existing = await prisma.pricingSource.findUnique({ where: { code: s.code } });
    if (existing) {
      await prisma.pricingSource.update({ where: { code: s.code }, data });
      updated++;
    } else {
      await prisma.pricingSource.create({ data });
      created++;
    }

    if (s.needsVerification) {
      console.log(`    ! ${s.code} flagged needsVerification: ${s.verificationNote}`);
    }
  }

  console.log(`  Sources: ${created} created, ${updated} updated.`);
}

async function main() {
  console.log("Starting pricing intelligence seed (districts, categories, unit conversions, sources)...");

  await seedDistricts();
  await seedCategories();
  await seedUnitConversions();
  await seedSources();

  const [districtCount, categoryCount, conversionCount, sourceCount] = await Promise.all([
    prisma.pricingDistrict.count(),
    prisma.pricingMaterialCategory.count(),
    prisma.pricingUnitConversion.count(),
    prisma.pricingSource.count(),
  ]);

  console.log("\nSeed summary:");
  console.log(`  pricing_district:         ${districtCount}`);
  console.log(`  pricing_material_category: ${categoryCount}`);
  console.log(`  pricing_unit_conversion:   ${conversionCount}`);
  console.log(`  pricing_source:            ${sourceCount}`);
  console.log("\nSeed complete. See docs/pricing/seed-review-checklist.md for what still needs human verification.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
