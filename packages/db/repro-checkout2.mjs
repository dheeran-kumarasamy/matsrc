import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const userId = 'csindhuece@gmail.com';

  // Find an inactive product to add to cart (simulates a product that was
  // active when added to cart but has since been delisted/deactivated).
  const inactiveProduct = await prisma.product.findFirst({ where: { isActive: false }, select: { id: true } });
  console.log('inactive product found:', JSON.stringify(inactiveProduct));

  if (inactiveProduct) {
    await prisma.cartItem.upsert({
      where: { userId_productId: { userId, productId: inactiveProduct.id } },
      update: { quantity: 1 },
      create: { userId, productId: inactiveProduct.id, quantity: 1 },
    });
    console.log('added inactive product to cart:', inactiveProduct.id);
  }
} catch (e) {
  console.error('ERROR', e);
} finally {
  await prisma.$disconnect();
}
