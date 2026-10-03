const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      status: "PLACED",
      user: { whatsappNumber: "918870519167" },
    },
    include: {
      user: { select: { id: true, name: true, phone: true, whatsappNumber: true } },
      items: { include: { product: true, supplier: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  console.log(
    JSON.stringify(
      orders.map((o) => ({
        id: o.id,
        enquiryId: o.enquiryId,
        status: o.status,
        items: o.items.map((i) => ({
          id: i.id,
          productName: i.product.name,
          unit: i.product.unit,
          quantity: i.quantity,
          supplierId: i.supplierId,
          supplierName: i.supplier.companyName,
        })),
      })),
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
