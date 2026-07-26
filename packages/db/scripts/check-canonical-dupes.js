const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const total = await prisma.product.count();
  const withCanonical = await prisma.product.count({ where: { canonicalProductId: { not: null } } });
  const withoutCanonical = await prisma.product.count({ where: { canonicalProductId: null } });
  console.log({ total, withCanonical, withoutCanonical });

  const groups = await prisma.canonicalProduct.findMany({
    include: { _count: { select: { products: true } } },
  });
  const multi = groups.filter((g) => g._count.products > 1);
  console.log('canonical groups total:', groups.length, 'groups with >1 product:', multi.length);

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      category: { select: { name: true } },
      brandRef: { select: { name: true } },
      brand: true,
      grade: true,
      unit: true,
      canonicalProductId: true,
      supplierId: true,
    },
  });
  const byKey = {};
  for (const p of products) {
    const key = `${p.category?.name}|${p.brandRef?.name ?? p.brand}|${p.grade}|${p.unit}`;
    byKey[key] = byKey[key] || [];
    byKey[key].push(p);
  }
  const dupes = Object.entries(byKey).filter(([, v]) => v.length > 1);
  console.log('groups by human-visible fields with >1 product:', dupes.length);
  for (const [k, v] of dupes.slice(0, 15)) {
    console.log(
      k,
      v.map((p) => ({ id: p.id, supplierId: p.supplierId, canonicalProductId: p.canonicalProductId }))
    );
  }
  await prisma.$disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
