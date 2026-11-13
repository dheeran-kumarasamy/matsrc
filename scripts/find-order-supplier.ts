import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../apps/api/.env") });

const prisma = new PrismaClient({ log: ["error"] });

async function main() {
  // Try exact match first, then partial
  const targetEnquiryId = process.env.ENQUIRY_ID ?? "EQ/2608/00008";

  const order = await prisma.order.findFirst({
    where: { enquiryId: targetEnquiryId },
    select: {
      id: true,
      enquiryId: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      items: {
        select: {
          id: true,
          supplierId: true,
          supplier: {
            select: {
              id: true,
              companyName: true,
              user: {
                select: {
                  id: true,
                  email: true,
                  phone: true,
                  whatsappNumber: true,
                  name: true,
                },
              },
            },
          },
          product: { select: { name: true } },
          quantity: true,
          unitPrice: true,
        },
      },
    },
  });

  if (!order) {
    console.log(`\n⚠️  Order "${targetEnquiryId}" not found in this database.`);
    console.log("\n── All orders in this DB ────────────────────────────────────");
    const all = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        enquiryId: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
        items: {
          take: 1,
          select: {
            supplier: {
              select: {
                companyName: true,
                user: { select: { email: true, phone: true } },
              },
            },
          },
        },
      },
    });
    for (const o of all) {
      const sup = o.items[0]?.supplier;
      console.log(
        `  ${o.enquiryId ?? "(no enquiryId)"}  |  ${o.status}  |  ${o.paymentStatus}  |  Supplier: ${
          sup?.companyName ?? "?"
        }  (${sup?.user?.email ?? sup?.user?.phone ?? "?"})`
      );
    }
    return;
  }

  console.log("── Order found ─────────────────────────────────────────────");
  console.log("  enquiryId:   ", order.enquiryId);
  console.log("  orderNumber: ", order.orderNumber ?? "(not yet generated)");
  console.log("  status:      ", order.status);
  console.log("  paymentStatus:", order.paymentStatus);
  console.log("\n── Suppliers to approve this order ─────────────────────────");

  const seen = new Set<string>();
  for (const item of order.items) {
    if (seen.has(item.supplierId)) continue;
    seen.add(item.supplierId);
    const s = item.supplier;
    console.log(`\n  Company:  ${s.companyName}`);
    console.log(`  Supplier profile ID: ${s.id}`);
    console.log(`  Login email:         ${s.user?.email ?? "(no email)"}`);
    console.log(`  Phone / WhatsApp:    ${s.user?.phone ?? s.user?.whatsappNumber ?? "(none)"}`);
    console.log(`  User name:           ${s.user?.name ?? "(none)"}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
