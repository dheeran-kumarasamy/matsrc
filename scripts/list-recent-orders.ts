import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../apps/api/.env") });

const prisma = new PrismaClient({ log: ["error"] });

async function main() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { id: true, enquiryId: true, orderNumber: true, status: true, paymentStatus: true, createdAt: true },
  });
  console.log("Recent orders:\n", JSON.stringify(orders, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
