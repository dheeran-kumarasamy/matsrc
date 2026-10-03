const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.supplierQuote.findMany({
    where: { enquiryId: "cmuqtlm7o0002taz37q56ybyq" },
  });
  console.log("existing SupplierQuote rows for this enquiry:", JSON.stringify(existing));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
