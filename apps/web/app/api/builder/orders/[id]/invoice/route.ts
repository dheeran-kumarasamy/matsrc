import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { serializeInvoice, invoiceInclude } from "@/lib/invoice-utils";

export const dynamic = "force-dynamic";

// GET /api/builder/orders/[id]/invoice
// Contractor/Client read-only view of their own generated invoice. Only an
// Admin can GENERATE an invoice (apps/admin + apps/api
// admin/orders/:orderId/invoice) — this route never creates one, it only
// reads the existing stored snapshot, scoped strictly to the requesting
// builder's own order so financial information never leaks across
// accounts.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { orderId: order.id },
      include: invoiceInclude,
    });

    if (!invoice) {
      return NextResponse.json({ error: "No invoice has been generated for this order yet" }, { status: 404 });
    }

    return NextResponse.json(serializeInvoice(invoice));
  } catch (error) {
    console.error("Builder invoice GET error:", error);
    return NextResponse.json({ error: "Failed to load invoice" }, { status: 500 });
  }
}
