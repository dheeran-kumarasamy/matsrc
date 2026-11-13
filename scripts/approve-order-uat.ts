/**
 * One-off UAT script: approve order EQ/2608/00008 all the way to DISPATCHED
 * so the builder side sees confirmationState === "CONFIRMED" and can test
 * the ICICI PG UAT payment link without needing to upload a supplier invoice.
 *
 * Run from repo root:
 *   cd packages/db && DATABASE_URL="$(grep DATABASE_URL ../../apps/api/.env | cut -d= -f2- | tr -d '"')" pnpm exec ts-node --skip-project ../../scripts/approve-order-uat.ts
 *
 * Or use the pnpm helper at the bottom of this file.
 */

import { PrismaClient, OrderStatus } from "@prisma/client";
import * as dotenv from "dotenv";
import * as path from "path";

// Load apps/api/.env so we hit the same DB the UAT app uses
dotenv.config({ path: path.resolve(__dirname, "../apps/api/.env") });

const prisma = new PrismaClient({ log: ["error"] });

const ENQUIRY_ID = "EQ/2608/00008";

// resolveBuyerConfirmationState rules (packages/db/lib/order-buyer-confirmation.ts):
//
//   PLACED                                   → NOT_YET_CONFIRMED      (no payment link)
//   PROCESSING + no/unconfirmed invoice      → AWAITING_FINAL_CONFIRM (no payment link)
//   PROCESSING + supplierInvoice.CONFIRMED   → CONFIRMED              (payment link ✅)
//   DISPATCHED / OUT_FOR_DELIVERY / DELIVERED (any invoice state) → CONFIRMED (payment link ✅)
//
// For UAT we want the payment link to appear immediately without uploading a
// supplier invoice, so we drive the order to DISPATCHED.
const TARGET_STATUS = OrderStatus.DISPATCHED;

async function main() {
  // ── 1. Find the order ────────────────────────────────────────────────────
  const order = await prisma.order.findFirst({
    where: { enquiryId: ENQUIRY_ID },
    select: {
      id: true,
      status: true,
      enquiryId: true,
      orderNumber: true,
      totalAmount: true,
      paymentStatus: true,
      items: {
        select: {
          id: true,
          supplierId: true,
          unitPrice: true,
          quantity: true,
          product: { select: { name: true } },
        },
      },
    },
  });

  if (!order) {
    console.error(`\n❌ Order with enquiryId "${ENQUIRY_ID}" not found in the DB.`);
    console.error("   Check that DATABASE_URL in apps/api/.env points to the UAT database.");
    process.exit(1);
  }

  console.log("── Order found ─────────────────────────────────────────────");
  console.log("  id:            ", order.id);
  console.log("  enquiryId:     ", order.enquiryId);
  console.log("  orderNumber:   ", order.orderNumber ?? "(not yet generated)");
  console.log("  status:        ", order.status);
  console.log("  paymentStatus: ", order.paymentStatus);
  console.log("  totalAmount:   ₹", Number(order.totalAmount));
  console.log("  items:         ", order.items.length);

  for (const item of order.items) {
    console.log(
      `    • ${item.product.name} × ${item.quantity}  @ ₹${Number(item.unitPrice)} (supplier: ${item.supplierId})`
    );
  }

  // ── 2. Guard: already at target or beyond ─────────────────────────────
  const terminalStatuses: string[] = [
    OrderStatus.DISPATCHED,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ];
  if (terminalStatuses.includes(order.status)) {
    console.log(`\n⚠️  Order is already in status "${order.status}" — confirmationState is already CONFIRMED.`);
    console.log("   Builder payment link: /orders/payment/" + order.id);
    return;
  }

  // ── 3. Transition: insert all intermediate tracking rows ─────────────────
  //    PLACED → PROCESSING → DISPATCHED (skipping OUT_FOR_DELIVERY for speed)
  const transitions: Array<{ status: OrderStatus; note: string }> = [];

  if (order.status === OrderStatus.PLACED) {
    transitions.push({
      status: OrderStatus.PROCESSING,
      note: "Supplier accepted enquiry (UAT approval script)",
    });
  }

  transitions.push({
    status: TARGET_STATUS,
    note: "Order dispatched — UAT script bypass so builder can test ICICI PG UAT payment",
  });

  for (const t of transitions) {
    await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: { status: t.status },
      }),
      prisma.orderTracking.create({
        data: {
          orderId: order.id,
          status: t.status,
          note: t.note,
        },
      }),
    ]);
    console.log(`\n  ✅ ${order.status} → ${t.status}`);
  }

  // ── 4. Final summary ─────────────────────────────────────────────────────
  console.log("\n── Done ────────────────────────────────────────────────────");
  console.log("   Final status:        DISPATCHED");
  console.log("   confirmationState:   CONFIRMED  ✅");
  console.log("   Payment link active: /orders/payment/" + order.id);
  console.log("\n📝 Builder next steps:");
  console.log("   1. Log in on the UAT buyer app as the buyer");
  console.log("   2. Go to My Orders → find EQ/2608/00008");
  console.log("   3. Click 'Pay Now' — ICICI PG UAT modal should appear");
  console.log("   Merchant ID:     100000000007164");
  console.log("   PG URL:          https://pgpayuat.icicibank.com");
}

main()
  .catch((err) => {
    console.error("\n❌ Script failed:", err?.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
