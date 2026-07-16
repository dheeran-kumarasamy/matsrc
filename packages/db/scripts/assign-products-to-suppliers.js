// packages/db/scripts/assign-products-to-suppliers.js
//
// One-off script: ensures the 8 existing catalog Product listings (Cement + TMT
// Bars, seeded via seed-catalog.js) exist for *every* SupplierProfile currently in
// the database. If a product's canonical (category + brand + grade + unit)
// combination is missing for a given supplier, a new Product row is created for
// that supplier, cloning the master data (category/brand/grade/unit/description/
// basePrice/stock) from the first supplier's existing listing.
//
// Idempotent: uses find-or-create (by unique slug) so re-running is safe.
//
// Usage (from repo root):
//   node packages/db/scripts/assign-products-to-suppliers.js
//
// Requires DATABASE_URL / DIRECT_URL to be set in the environment (see root .env).

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function findOrCreateProductForSupplier(sourceProduct, supplierId) {
  // Re-derive the display name without the previous supplier's slug suffix.
  const baseName = sourceProduct.name;
  const slug = slugify(`${baseName}-${supplierId.slice(-6)}`);

  let product = await prisma.product.findUnique({ where: { slug } });
  if (product) {
    console.log(`  = Product already exists for supplier ${supplierId}: "${baseName}"`);
    return product;
  }

  product = await prisma.product.create({
    data: {
      supplierId,
      categoryId: sourceProduct.categoryId,
      name: baseName,
      slug,
      brand: sourceProduct.brand,
      grade: sourceProduct.grade,
      brandId: sourceProduct.brandId,
      gradeId: sourceProduct.gradeId,
      unitId: sourceProduct.unitId,
      isCode: sourceProduct.isCode,
      bisStatus: sourceProduct.bisStatus,
      description: sourceProduct.description,
      unit: sourceProduct.unit,
      basePrice: sourceProduct.basePrice,
      stock: sourceProduct.stock,
      maxServiceableQty: sourceProduct.maxServiceableQty,
      images: sourceProduct.images,
      isActive: true,
    },
  });
  console.log(`  + created Product for supplier ${supplierId}: "${baseName}" (₹${sourceProduct.basePrice}/${sourceProduct.unit})`);
  return product;
}

async function main() {
  console.log("Assigning all catalog products to every supplier in the database...");

  const suppliers = await prisma.supplierProfile.findMany({ orderBy: { createdAt: "asc" } });
  if (suppliers.length === 0) {
    throw new Error("No SupplierProfile found in the database.");
  }
  console.log(`Found ${suppliers.length} supplier(s):`);
  suppliers.forEach((s) => console.log(`  - ${s.companyName} (${s.id})`));

  // Use the earliest-created supplier's products as the canonical source set —
  // these are the 8 catalog products seeded via seed-catalog.js.
  const sourceSupplier = suppliers[0];
  const sourceProducts = await prisma.product.findMany({
    where: { supplierId: sourceSupplier.id },
    orderBy: { createdAt: "asc" },
  });

  if (sourceProducts.length === 0) {
    throw new Error(`No products found for source supplier ${sourceSupplier.id}. Run seed-catalog.js first.`);
  }
  console.log(`\nUsing ${sourceProducts.length} product(s) from "${sourceSupplier.companyName}" as the source catalog.\n`);

  for (const supplier of suppliers) {
    console.log(`Supplier: ${supplier.companyName} (${supplier.id})`);
    for (const sourceProduct of sourceProducts) {
      await findOrCreateProductForSupplier(sourceProduct, supplier.id);
    }
  }

  const productCount = await prisma.product.count();
  console.log("\nDone. Total products in DB:", productCount);
}

main()
  .catch((err) => {
    console.error("Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
