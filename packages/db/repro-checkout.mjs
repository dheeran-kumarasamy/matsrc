import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const userId = 'csindhuece@gmail.com';
  const product = await prisma.product.findFirst({ where: { isActive: true }, select: { id: true, basePrice: true, supplierId: true } });
  console.log('sample active product:', JSON.stringify(product));
  await prisma.cartItem.upsert({
    where: { userId_productId: { userId, productId: product.id } },
    update: { quantity: 2 },
    create: { userId, productId: product.id, quantity: 2 },
  });
  console.log('added to cart:', product.id);

  const sites = await prisma.site.findMany({ where: { builderId: userId, status: 'ACTIVE' }, select: { id: true, name: true } });
  console.log('sites:', JSON.stringify(sites));
} catch (e) {
  console.error('ERROR', e);
} finally {
  await prisma.$disconnect();
}
