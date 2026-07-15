// packages/db/scripts/seed-catalog.js
//
// One-off seed script: creates initial catalog master data (Category, Brand, Unit)
// and Product listings for two product lines — Cement and TMT Bars — each with the
// top 4 brands in the Indian construction-materials market, attached to the first
// existing SupplierProfile found in the database.
//
// Idempotent: uses find-or-create (upsert-by-unique-field) patterns throughout, so
// re-running this script will not create duplicate Category/Brand/Unit/Product rows.
//
// Usage (from repo root):
//   node packages/db/scripts/seed-catalog.js
//
// Requires DATABASE_URL / DIRECT_URL to be set in the environment (e.g. via the root
// .env file — see AGENTS.md for how this repo wires env vars for Prisma).

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const CATEGORIES = [
  { name: "Cement", slug: "cement" },
  { name: "TMT Bars", slug: "tmt-bars" },
];

const UNITS = {
  BAG: { name: "Bag (50kg)", code: "BAG" },
  MT: { name: "Metric Ton", code: "MT" },
};

// Top 4 brands in the Indian market for each product line, with a representative
// listing (grade/description/base price/stock) per brand.
const CATALOG = {
  Cement: {
    unit: UNITS.BAG,
    items: [
      {
        brand: "UltraTech Cement",
        grade: "OPC 53 Grade",
        description: "UltraTech OPC 53 Grade cement — high strength, ideal for RCC structural work.",
        basePrice: 380,
        stock: 5000,
      },
      {
        brand: "ACC Cement",
        grade: "PPC",
        description: "ACC Portland Pozzolana Cement — durable, suited for general construction and plastering.",
        basePrice: 365,
        stock: 4500,
      },
      {
        brand: "Ambuja Cement",
        grade: "PPC",
        description: "Ambuja Cement PPC — reliable strength and workability for residential and commercial builds.",
        basePrice: 370,
        stock: 4800,
      },
      {
        brand: "Shree Cement",
        grade: "OPC 43 Grade",
        description: "Shree Cement OPC 43 Grade — cost-effective, widely used for general RCC and masonry work.",
        basePrice: 355,
        stock: 5200,
      },
    ],
  },
  "TMT Bars": {
    unit: UNITS.MT,
    items: [
      {
        brand: "TATA Tiscon",
        grade: "Fe 550D",
        description: "TATA Tiscon Fe 550D TMT bars — earthquake-resistant, corrosion-resistant rebar.",
        basePrice: 62000,
        stock: 200,
      },
      {
        brand: "JSW Neosteel",
        grade: "Fe 550D",
        description: "JSW Neosteel Fe 550D TMT bars — high ductility, ideal for seismic-zone construction.",
        basePrice: 61000,
        stock: 180,
      },
      {
        brand: "SAIL",
        grade: "Fe 500",
        description: "SAIL Fe 500 TMT bars — BIS-certified structural steel reinforcement bars.",
        basePrice: 59500,
        stock: 220,
      },
      {
        brand: "Kamdhenu Steel",
        grade: "Fe 500D",
        description: "Kamdhenu Fe 500D TMT bars — strong, ductile rebar for residential and infra projects.",
        basePrice: 58500,
        stock: 190,
      },
    ],
  },
};

async function findOrCreateCategory({ name, slug }) {
  let category = await prisma.category.findUnique({ where: { slug } });
  if (!category) {
    category = await prisma.category.create({ data: { name, slug, isActive: true } });
    console.log(`  + created Category: "${name}"`);
  } else {
    console.log(`  = Category already exists: "${name}"`);
  }
  return category;
}

async function findOrCreateBrand(name) {
  const slug = slugify(name);
  let brand = await prisma.brand.findUnique({ where: { slug } });
  if (!brand) {
    brand = await prisma.brand.create({ data: { name, slug, isActive: true } });
    console.log(`  + created Brand: "${name}"`);
  } else {
    console.log(`  = Brand already exists: "${name}"`);
  }
  return brand;
}

async function findOrCreateUnit({ name, code }) {
  let unit = await prisma.unit.findUnique({ where: { code } });
  if (!unit) {
    unit = await prisma.unit.create({ data: { name, code, isActive: true } });
    console.log(`  + created Unit: "${name}" (${code})`);
  } else {
    console.log(`  = Unit already exists: "${name}" (${code})`);
  }
  return unit;
}

async function findOrCreateProduct({ supplierId, category, brand, unit, grade, description, basePrice, stock }) {
  const name = `${brand.name} ${grade} ${category.name}`;
  const slug = slugify(`${name}-${supplierId.slice(-6)}`);

  let product = await prisma.product.findUnique({ where: { slug } });
  if (!product) {
    product = await prisma.product.create({
      data: {
        supplierId,
        categoryId: category.id,
        name,
        slug,
        brand: brand.name, // deprecated free-text mirror, kept for backfill/history consistency
        grade,
        brandId: brand.id,
        unitId: unit.id,
        description,
        unit: unit.code, // deprecated free-text mirror
        basePrice,
        stock,
        images: [],
        isActive: true,
      },
    });
    console.log(`  + created Product: "${name}" (₹${basePrice}/${unit.code})`);
  } else {
    console.log(`  = Product already exists: "${name}"`);
  }
  return product;
}

async function main() {
  console.log("Starting catalog seed (Cement + TMT Bars, top 4 brands each)...");

  const supplier = await prisma.supplierProfile.findFirst({ orderBy: { createdAt: "asc" } });
  if (!supplier) {
    throw new Error(
      "No SupplierProfile found in the database. Create at least one supplier account before seeding products."
    );
  }
  console.log(`Using SupplierProfile: ${supplier.companyName} (${supplier.id})`);

  const unitCache = new Map();

  for (const categoryDef of CATEGORIES) {
    const category = await findOrCreateCategory(categoryDef);
    const catalogEntry = CATALOG[categoryDef.name];

    let unit = unitCache.get(catalogEntry.unit.code);
    if (!unit) {
      unit = await findOrCreateUnit(catalogEntry.unit);
      unitCache.set(catalogEntry.unit.code, unit);
    }

    for (const item of catalogEntry.items) {
      const brand = await findOrCreateBrand(item.brand);
      await findOrCreateProduct({
        supplierId: supplier.id,
        category,
        brand,
        unit,
        grade: item.grade,
        description: item.description,
        basePrice: item.basePrice,
        stock: item.stock,
      });
    }
  }

  const [categoryCount, brandCount, productCount] = await Promise.all([
    prisma.category.count(),
    prisma.brand.count(),
    prisma.product.count(),
  ]);

  console.log("\nSeed summary:");
  console.log(`  Categories: ${categoryCount}`);
  console.log(`  Brands:     ${brandCount}`);
  console.log(`  Products:   ${productCount}`);
  console.log("\nSeed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
