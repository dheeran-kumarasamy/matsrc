// packages/db/scripts/backfill-catalog-master-data.js
//
// One-off backfill script (Phase P-1 + P0):
//   1. Scans existing Product rows for free-text `brand` / `grade` / `unit` values.
//   2. Creates/normalizes corresponding Brand / Grade / Unit master rows (best-effort:
//      trim + collapse whitespace, slug/code derived from the normalized label).
//   3. Sets Product.brandId / gradeId / unitId FK columns accordingly.
//   4. Computes a deterministic canonicalKey (categoryId + brandId + gradeId + unitId
//      + sizeLabel) for every Product, creates/links a CanonicalProduct row, and
//      sets Product.canonicalProductId. sizeLabel participates as a plain
//      normalized string (not an FK) — see the CanonicalProduct model's doc
//      comment in schema.prisma for why it was added.
//
// Safe to re-run (idempotent): uses upsert/find-or-create patterns throughout, and only
// ever fills in null FK columns — never overwrites already-resolved values.
//
// Usage (from repo root):
//   node packages/db/scripts/backfill-catalog-master-data.js
//   node packages/db/scripts/backfill-catalog-master-data.js --dry-run
//
// Requires DATABASE_URL / DIRECT_URL to be set in the environment (e.g. via the root
// .env file — see README/AGENTS.md for how this repo wires env vars for Prisma).

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes("--dry-run");

function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeLabel(input) {
  return String(input).trim().replace(/\s+/g, " ");
}

function shortCode(label) {
  // Derive a short unit code, e.g. "Metric Ton" -> "METRIC-TON", "MT" -> "MT".
  const cleaned = normalizeLabel(label).toUpperCase();
  if (cleaned.length <= 8 && !cleaned.includes(" ")) return cleaned;
  return cleaned
    .split(" ")
    .map((w) => w.slice(0, 3))
    .join("-")
    .slice(0, 12);
}

async function findOrCreateBrand(rawName, cache) {
  const label = normalizeLabel(rawName);
  const key = label.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const slug = slugify(label);
  let brand = await prisma.brand.findFirst({
    where: { OR: [{ name: label }, { slug }] },
  });
  if (!brand) {
    if (DRY_RUN) {
      console.log(`[dry-run] would create Brand: "${label}" (slug: ${slug})`);
      brand = { id: `dryrun-brand-${slug}`, name: label, slug };
    } else {
      brand = await prisma.brand.create({
        data: { name: label, slug, isActive: true },
      });
      console.log(`  + created Brand: "${label}"`);
    }
  }
  cache.set(key, brand);
  return brand;
}

async function findOrCreateGrade(rawName, cache) {
  const label = normalizeLabel(rawName);
  const key = label.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const slug = slugify(label);
  let grade = await prisma.grade.findFirst({
    where: { OR: [{ name: label }, { slug }] },
  });
  if (!grade) {
    if (DRY_RUN) {
      console.log(`[dry-run] would create Grade: "${label}" (slug: ${slug})`);
      grade = { id: `dryrun-grade-${slug}`, name: label, slug };
    } else {
      grade = await prisma.grade.create({
        data: { name: label, slug, isActive: true },
      });
      console.log(`  + created Grade: "${label}"`);
    }
  }
  cache.set(key, grade);
  return grade;
}

async function findOrCreateUnit(rawName, cache) {
  const label = normalizeLabel(rawName);
  const key = label.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const code = shortCode(label);
  let unit = await prisma.unit.findFirst({
    where: { OR: [{ name: label }, { code }] },
  });
  if (!unit) {
    if (DRY_RUN) {
      console.log(`[dry-run] would create Unit: "${label}" (code: ${code})`);
      unit = { id: `dryrun-unit-${code}`, name: label, code };
    } else {
      // code must be unique; if a collision occurs (different label, same code),
      // fall back to appending a numeric suffix.
      let finalCode = code;
      let attempt = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const existing = await prisma.unit.findUnique({ where: { code: finalCode } });
        if (!existing) break;
        attempt += 1;
        finalCode = `${code}-${attempt}`;
      }
      unit = await prisma.unit.create({
        data: { name: label, code: finalCode, isActive: true },
      });
      console.log(`  + created Unit: "${label}" (code: ${unit.code})`);
    }
  }
  cache.set(key, unit);
  return unit;
}

// sizeLabel participates in the key as a plain normalized string (not an
// id) — unlike brand/grade/unit it is NOT its own FK master-data table.
// See the CanonicalProduct model's doc comment in schema.prisma for why
// this was added: two listings that only differ by size (e.g. an 8mm vs.
// 16mm TMT bar, same category/brand/grade/unit) previously computed an
// IDENTICAL canonicalKey and were silently merged, hiding every size
// except the group's lowest-priced one from the buyer-facing PLP.
function canonicalKeyFor({ categoryId, brandId, gradeId, unitId, sizeLabel }) {
  return [categoryId, brandId ?? "none", gradeId ?? "none", unitId ?? "none", sizeLabel ?? "none"].join(":");
}

async function findOrCreateCanonicalProduct({ categoryId, brandId, gradeId, unitId, sizeLabel, title }, cache) {
  const key = canonicalKeyFor({ categoryId, brandId, gradeId, unitId, sizeLabel });
  if (cache.has(key)) return cache.get(key);

  let canonical = await prisma.canonicalProduct.findUnique({ where: { canonicalKey: key } });
  if (!canonical) {
    if (DRY_RUN) {
      console.log(`[dry-run] would create CanonicalProduct: "${title}" (key: ${key})`);
      canonical = { id: `dryrun-canonical-${key}`, canonicalKey: key, title };
    } else {
      canonical = await prisma.canonicalProduct.create({
        data: {
          canonicalKey: key,
          categoryId,
          brandId: brandId ?? undefined,
          gradeId: gradeId ?? undefined,
          unitId: unitId ?? undefined,
          sizeLabel: sizeLabel ?? undefined,
          title,
        },
      });
      console.log(`  + created CanonicalProduct: "${title}" (key: ${key})`);
    }
  }
  cache.set(key, canonical);
  return canonical;
}

async function main() {
  console.log(`Starting catalog master-data backfill${DRY_RUN ? " (DRY RUN — no writes)" : ""}...`);

  const brandCache = new Map();
  const gradeCache = new Map();
  const unitCache = new Map();
  const canonicalCache = new Map();

  const products = await prisma.product.findMany({
    include: { category: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${products.length} Product rows to process.`);

  let brandLinked = 0;
  let gradeLinked = 0;
  let unitLinked = 0;
  let canonicalLinked = 0;
  let skippedAlreadyResolved = 0;

  for (const product of products) {
    const updateData = {};

    // --- Brand ---
    let brandId = product.brandId ?? null;
    if (!brandId && product.brand && product.brand.trim()) {
      const brand = await findOrCreateBrand(product.brand, brandCache);
      brandId = brand.id;
      updateData.brandId = brandId;
      brandLinked += 1;
    }

    // --- Grade ---
    let gradeId = product.gradeId ?? null;
    if (!gradeId && product.grade && product.grade.trim()) {
      const grade = await findOrCreateGrade(product.grade, gradeCache);
      gradeId = grade.id;
      updateData.gradeId = gradeId;
      gradeLinked += 1;
    }

    // --- Unit ---
    let unitId = product.unitId ?? null;
    if (!unitId && product.unit && product.unit.trim()) {
      const unit = await findOrCreateUnit(product.unit, unitCache);
      unitId = unit.id;
      updateData.unitId = unitId;
      unitLinked += 1;
    }

    // --- CanonicalProduct ---
    let canonicalProductId = product.canonicalProductId ?? null;
    if (!canonicalProductId) {
      const title = [product.category?.name, product.brand, product.grade]
        .filter(Boolean)
        .join(" ") || product.name;
      const canonical = await findOrCreateCanonicalProduct(
        { categoryId: product.categoryId, brandId, gradeId, unitId, sizeLabel: product.sizeLabel ?? null, title },
        canonicalCache
      );
      canonicalProductId = canonical.id;
      updateData.canonicalProductId = canonicalProductId;
      canonicalLinked += 1;
    }

    if (Object.keys(updateData).length === 0) {
      skippedAlreadyResolved += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(`[dry-run] would update Product ${product.id} (${product.name}) ->`, updateData);
    } else {
      await prisma.product.update({ where: { id: product.id }, data: updateData });
    }
  }

  console.log("\nBackfill summary:");
  console.log(`  Products processed:          ${products.length}`);
  console.log(`  Already fully resolved:      ${skippedAlreadyResolved}`);
  console.log(`  brandId set:                 ${brandLinked}`);
  console.log(`  gradeId set:                 ${gradeLinked}`);
  console.log(`  unitId set:                  ${unitLinked}`);
  console.log(`  canonicalProductId set:      ${canonicalLinked}`);
  console.log(`  Distinct Brands touched:     ${brandCache.size}`);
  console.log(`  Distinct Grades touched:     ${gradeCache.size}`);
  console.log(`  Distinct Units touched:      ${unitCache.size}`);
  console.log(`  Distinct CanonicalProducts:  ${canonicalCache.size}`);
  console.log(DRY_RUN ? "\nDry run complete — no changes were written." : "\nBackfill complete.");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
