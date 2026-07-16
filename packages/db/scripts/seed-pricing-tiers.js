// packages/db/scripts/seed-pricing-tiers.js
//
// One-off script: creates 3-tier bulk pricing (PricingTier rows) for every
// active Product belonging to every supplier in the database, so all listings
// (across both/all suppliers) offer more than 2 pricing tiers.
//
// Tiers are contiguous ranges from qty 1 up to the product's
// maxServiceableQty (falling back to `stock` when maxServiceableQty is unset),
// with unit price stepping down as quantity increases:
//   Tier 1: 1        .. tier1Max   -> basePrice
//   Tier 2: tier1Max+1 .. tier2Max -> basePrice * 0.95 (5% off)
//   Tier 3: tier2Max+1 .. maxQty   -> basePrice * 0.90 (10% off)
//
// This mirrors the contiguous-range validation rules already enforced by the
// supplier app (apps/supplier/lib/supplier-data.ts: normalizePricingTiers):
//   - first tier must start at 1
//   - tiers must be contiguous (no gaps/overlaps)
//   - last tier must end at maxServiceableQty
//
// Idempotent: if a product already has >= 3 PricingTier rows, it is skipped.
// Otherwise any existing PricingTier rows for that product are replaced.
//
// Usage (from repo root):
//   node packages/db/scripts/seed-pricing-tiers.js
//
// Requires DATABASE_URL / DIRECT_URL to be set in the environment (see root .env).

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Rounds to the nearest whole rupee (unit prices in this catalog are whole numbers).
function round(n) {
  return Math.round(n);
}

function buildTiers(basePrice, maxQty) {
  const base = Number(basePrice);
  const max = Math.max(1, Math.floor(Number(maxQty)));

  if (max < 3) {
    // Not enough quantity range to form 3 contiguous integer tiers — fall back
    // to a single tier covering the whole range at basePrice.
    return [{ minQty: 1, maxQty: max, tierPrice: base }];
  }

  const tier1Max = Math.max(1, Math.floor(max * 0.3));
  const tier2Max = Math.max(tier1Max + 1, Math.floor(max * 0.7));
  const tier3Max = max;

  return [
    { minQty: 1, maxQty: tier1Max, tierPrice: base },
    { minQty: tier1Max + 1, maxQty: tier2Max, tierPrice: round(base * 0.95) },
    { minQty: tier2Max + 1, maxQty: tier3Max, tierPrice: round(base * 0.9) },
  ];
}

async function seedTiersForProduct(product) {
  const existingCount = await prisma.pricingTier.count({ where: { productId: product.id } });
  if (existingCount >= 3) {
    console.log(`  = Skipping "${product.name}" (already has ${existingCount} pricing tiers)`);
    return;
  }

  const maxQty = product.maxServiceableQty ?? product.stock ?? 1;
  const tiers = buildTiers(product.basePrice, maxQty);

  await prisma.$transaction(async (tx) => {
    await tx.pricingTier.deleteMany({ where: { productId: product.id } });
    await tx.pricingTier.createMany({
      data: tiers.map((tier) => ({
        productId: product.id,
        minQty: tier.minQty,
        maxQty: tier.maxQty,
        tierPrice: tier.tierPrice,
      })),
    });

    // Ensure maxServiceableQty is set so future edits in the supplier UI keep
    // the contiguous-range validation consistent with these seeded tiers.
    if (!product.maxServiceableQty) {
      await tx.product.update({
        where: { id: product.id },
        data: { maxServiceableQty: maxQty },
      });
    }
  });

  console.log(
    `  + seeded ${tiers.length} pricing tiers for "${product.name}" (supplier ${product.supplierId}): ` +
      tiers.map((t) => `${t.minQty}-${t.maxQty}@₹${t.tierPrice}`).join(", ")
  );
}

async function main() {
  console.log("Seeding 3-tier bulk pricing for all products across all suppliers...");

  const products = await prisma.product.findMany({ orderBy: { createdAt: "asc" } });
  if (products.length === 0) {
    throw new Error("No Product rows found in the database.");
  }

  const suppliers = await prisma.supplierProfile.findMany({ select: { id: true, companyName: true } });
  console.log(`Found ${products.length} product(s) across ${suppliers.length} supplier(s).\n`);

  for (const product of products) {
    await seedTiersForProduct(product);
  }

  const tierCount = await prisma.pricingTier.count();
  console.log(`\nDone. Total PricingTier rows in DB: ${tierCount}`);
}

main()
  .catch((err) => {
    console.error("Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
