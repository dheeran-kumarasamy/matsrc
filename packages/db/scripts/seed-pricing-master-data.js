// packages/db/scripts/seed-pricing-master-data.js
//
// Phase 1 Master Data Foundation seed script for Price Intelligence module.
// Upserts:
//   1. Delhi state (PricingState) and Delhi district (PricingDistrict)
//   2. TMT Steel child categories (PricingMaterialCategory)
//   3. Canonical SKUs (PricingCanonicalSku) for TMT rebar grades & sizes
//   4. SKU Aliases (PricingSkuAlias) mapping Jindal Panther & Agni Steels raw labels
//   5. PricingSourceEndpoint trusted geography configurations
//
// Idempotent by design — safe to run multiple times without duplicating rows.

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function seedGeography() {
  console.log("Seeding geography master data (Delhi state & district)...");

  // 1. Delhi State
  const state = await prisma.pricingState.upsert({
    where: { code: "DL" },
    create: {
      id: "pgstate_delhi",
      code: "DL",
      name: "Delhi",
    },
    update: {
      name: "Delhi",
    },
  });

  // 2. Delhi District
  const district = await prisma.pricingDistrict.upsert({
    where: { code: "DL-DEL" },
    create: {
      id: "pgdistrict_delhi",
      code: "DL-DEL",
      name: "Delhi",
      region: "North",
      isMetro: true,
      stateId: state.id,
    },
    update: {
      name: "Delhi",
      region: "North",
      isMetro: true,
      stateId: state.id,
    },
  });

  console.log(`  State: ${state.name} (${state.code}), District: ${district.name} (${district.code})`);
  return { state, district };
}

async function seedCategories() {
  console.log("Ensuring TMT steel material categories exist...");

  const tmtParent = await prisma.pricingMaterialCategory.findUnique({
    where: { code: "TMT_STEEL" },
  });

  if (!tmtParent) {
    throw new Error("Parent category TMT_STEEL not found. Run main seed-pricing.js first.");
  }

  const childCategories = [
    { code: "TMT_STEEL_FE500", name: "Fe 500" },
    { code: "TMT_STEEL_FE500D", name: "Fe 500D" },
    { code: "TMT_STEEL_FE550", name: "Fe 550" },
    { code: "TMT_STEEL_FE550D", name: "Fe 550D" },
    { code: "TMT_STEEL_FE550D_CRS", name: "Fe 550D-CRS" },
    { code: "TMT_STEEL_FE600", name: "Fe 600" },
  ];

  const catMap = new Map();
  catMap.set("TMT_STEEL", tmtParent.id);

  for (const child of childCategories) {
    const cat = await prisma.pricingMaterialCategory.upsert({
      where: { code: child.code },
      create: {
        code: child.code,
        name: child.name,
        parentId: tmtParent.id,
        baseUnit: tmtParent.baseUnit,
        displayUnit: tmtParent.displayUnit,
      },
      update: {
        name: child.name,
        parentId: tmtParent.id,
      },
    });
    catMap.set(child.code, cat.id);
  }

  console.log(`  Categorized ${catMap.size} TMT steel category codes.`);
  return catMap;
}

async function seedCanonicalSkus(catMap) {
  console.log("Seeding Canonical SKUs for TMT Steel...");

  const grades = [
    { grade: "Fe 500", codePrefix: "FE500", catCode: "TMT_STEEL_FE500" },
    { grade: "Fe 500D", codePrefix: "FE500D", catCode: "TMT_STEEL_FE500D" },
    { grade: "Fe 550", codePrefix: "FE550", catCode: "TMT_STEEL_FE550" },
    { grade: "Fe 550D", codePrefix: "FE550D", catCode: "TMT_STEEL_FE550D" },
    { grade: "Fe 550D-CRS", codePrefix: "FE550D_CRS", catCode: "TMT_STEEL_FE550D_CRS" },
    { grade: "Fe 600", codePrefix: "FE600", catCode: "TMT_STEEL_FE600" },
  ];

  const sizes = [6, 8, 10, 12, 16, 20, 25, 28, 32];
  let createdCount = 0;
  const skuMap = new Map();

  for (const g of grades) {
    const categoryId = catMap.get(g.catCode) || catMap.get("TMT_STEEL");
    for (const size of sizes) {
      const code = `TMT_${g.codePrefix}_${size}MM_GENERIC`;
      const fingerprint = `tmt_steel:null:${g.grade.toLowerCase().replace(/[^a-z0-9]/g, "_")}:${size}`;

      const sku = await prisma.pricingCanonicalSku.upsert({
        where: { code },
        create: {
          code,
          materialCategoryId: categoryId,
          grade: g.grade,
          sizeMm: size,
          sizeLabel: `${size} mm`,
          fingerprint,
          baseUnit: "KG",
          isActive: true,
          specJson: {
            nominalWeightKgPerMeter: Number((0.00617 * size * size).toFixed(4)),
          },
        },
        update: {
          grade: g.grade,
          sizeMm: size,
          sizeLabel: `${size} mm`,
          baseUnit: "KG",
          isActive: true,
          specJson: {
            nominalWeightKgPerMeter: Number((0.00617 * size * size).toFixed(4)),
          },
        },
      });

      skuMap.set(code, sku);
      createdCount++;
    }
  }

  console.log(`  Canonical SKUs: ${createdCount} TMT steel SKU combinations upserted.`);
  return skuMap;
}

async function seedAliases(skuMap) {
  console.log("Seeding SKU Aliases for Jindal Panther & Agni Steels...");

  const jindalSource = await prisma.pricingSource.findUnique({ where: { code: "JINDAL_PANTHER" } });
  const agniSource = await prisma.pricingSource.findUnique({ where: { code: "AGNI_STEELS" } });

  const aliasMappings = [
    // Jindal Panther 23 Raw Labels
    { source: jindalSource, rawLabel: "TMT Fe 550D 6 mm (500D)", skuCode: "TMT_FE550D_6MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D 8 mm", skuCode: "TMT_FE550D_8MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D-CRS 8 mm", skuCode: "TMT_FE550D_CRS_8MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 600 8 mm", skuCode: "TMT_FE600_8MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D 10 mm", skuCode: "TMT_FE550D_10MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D-CRS 10 mm", skuCode: "TMT_FE550D_CRS_10MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 600 10 mm", skuCode: "TMT_FE600_10MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D 12 mm", skuCode: "TMT_FE550D_12MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D-CRS 12 mm", skuCode: "TMT_FE550D_CRS_12MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 600 12 mm", skuCode: "TMT_FE600_12MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D 16 mm", skuCode: "TMT_FE550D_16MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D-CRS 16 mm", skuCode: "TMT_FE550D_CRS_16MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 600 16 mm", skuCode: "TMT_FE600_16MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D 20 mm", skuCode: "TMT_FE550D_20MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D-CRS 20 mm", skuCode: "TMT_FE550D_CRS_20MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 600 20 mm", skuCode: "TMT_FE600_20MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D 25 mm", skuCode: "TMT_FE550D_25MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D-CRS 25 mm", skuCode: "TMT_FE550D_CRS_25MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 600 25 mm", skuCode: "TMT_FE600_25MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D 28 mm", skuCode: "TMT_FE550D_28MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D 32 mm", skuCode: "TMT_FE550D_32MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 550D-CRS 32 mm", skuCode: "TMT_FE550D_CRS_32MM_GENERIC" },
    { source: jindalSource, rawLabel: "TMT Fe 600 32 mm", skuCode: "TMT_FE600_32MM_GENERIC" },

    // Agni Steels Raw Labels
    { source: agniSource, rawLabel: "TMT Fe 550", skuCode: "TMT_FE550_12MM_GENERIC" },
    { source: agniSource, rawLabel: "TMT Fe 500D", skuCode: "TMT_FE500D_12MM_GENERIC" },
  ];

  let count = 0;
  for (const m of aliasMappings) {
    if (!m.source) continue;

    const sku = skuMap.get(m.skuCode) || (await prisma.pricingCanonicalSku.findUnique({ where: { code: m.skuCode } }));
    if (!sku) {
      console.warn(`  Warning: Target canonical SKU "${m.skuCode}" not found for raw label "${m.rawLabel}"`);
      continue;
    }

    const normalizedLabel = m.rawLabel.trim().toLowerCase().replace(/\s+/g, " ");

    await prisma.pricingSkuAlias.upsert({
      where: {
        sourceId_rawLabel: { sourceId: m.source.id, rawLabel: m.rawLabel },
      },
      create: {
        sourceId: m.source.id,
        rawLabel: m.rawLabel,
        normalizedLabel,
        canonicalSkuId: sku.id,
        matchType: "EXACT",
        occurrenceCount: 1,
      },
      update: {
        normalizedLabel,
        canonicalSkuId: sku.id,
        matchType: "EXACT",
      },
    });

    count++;
  }

  console.log(`  SKU Aliases: ${count} deterministic aliases upserted.`);
}

async function updateEndpointGeography({ state, district }) {
  console.log("Updating PricingSourceEndpoint trusted geography configurations...");

  const jindalSource = await prisma.pricingSource.findUnique({ where: { code: "JINDAL_PANTHER" } });
  if (jindalSource) {
    const endpoint = await prisma.pricingSourceEndpoint.findFirst({ where: { sourceId: jindalSource.id } });
    if (endpoint) {
      await prisma.pricingSourceEndpoint.update({
        where: { id: endpoint.id },
        data: {
          geographyLevel: "STATE",
          stateId: state.id,
          districtId: null,
        },
      });
      console.log(`  Updated Jindal Panther endpoint ${endpoint.id} -> geographyLevel=STATE, stateId=${state.id}`);
    }
  }

  const agniSource = await prisma.pricingSource.findUnique({ where: { code: "AGNI_STEELS" } });
  if (agniSource) {
    const tnState = await prisma.pricingState.findUnique({ where: { code: "TN" } });
    if (tnState) {
      const endpoint = await prisma.pricingSourceEndpoint.findFirst({ where: { sourceId: agniSource.id } });
      if (endpoint) {
        await prisma.pricingSourceEndpoint.update({
          where: { id: endpoint.id },
          data: {
            geographyLevel: "STATE",
            stateId: tnState.id,
            districtId: null,
          },
        });
        console.log(`  Updated Agni Steels endpoint ${endpoint.id} -> geographyLevel=STATE, stateId=${tnState.id}`);
      }
    }
  }
}

async function main() {
  console.log("=== BuildOHub Pricing Master Data Seed (Phase 1) ===");

  const { state, district } = await seedGeography();
  const catMap = await seedCategories();
  const skuMap = await seedCanonicalSkus(catMap);
  await seedAliases(skuMap);
  await updateEndpointGeography({ state, district });

  console.log("\n=== Phase 1 Master Data Seed Complete ===");
}

main()
  .catch((err) => {
    console.error("Master data seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
