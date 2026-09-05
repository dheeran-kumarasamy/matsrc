import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ log: ['error'] });
async function main() {
  try {
    const rows = await prisma.user.findMany({ take: 1 });
    console.log('user findMany ok', rows.length);
  } catch (e) { console.error('user findMany ERROR:', e.message); }
  try {
    const rows = await prisma.notification.findMany({ take: 1 });
    console.log('notification findMany ok', rows.length);
  } catch (e) { console.error('notification findMany ERROR:', e.message); }
  try {
    const rows = await prisma.watchlist.findMany({ take: 1, include: { product: true } });
    console.log('watchlist findMany ok', rows.length);
  } catch (e) { console.error('watchlist findMany ERROR:', e.message); }
  await prisma.$disconnect();
}
main();
