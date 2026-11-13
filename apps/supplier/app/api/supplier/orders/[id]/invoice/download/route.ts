import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@matsrc/db";
import { ensureSupplierContext } from "@/lib/supplier-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/supplier/orders/[id]/invoice/download
// Streams the raw, ORIGINAL supplier-invoice bytes to the authenticated,
// OWNING supplier only — never a public/static URL, mirrors the existing
// rating-receipt/payment-proof bytes-serving convention exactly.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { supplierProfile } = await ensureSupplierContext(email);

    const order = await prisma.order.findFirst({
      where: { id: params.id, items: { some: { supplierId: supplierProfile.id } } },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const invoice = await prisma.supplierInvoice.findUnique({
      where: { orderId: order.id },
      select: { fileData: true, fileMimeType: true, fileName: true, supplierId: true },
    });

    // Ownership double-check against the invoice row itself (not just the
    // order's line items) — a supplier can never download another
    // supplier's uploaded invoice even if both happen to share an order id
    // in some edge case.
    if (!invoice || invoice.supplierId !== supplierProfile.id) {
      return NextResponse.json({ error: "No invoice found for this order" }, { status: 404 });
    }

    return new NextResponse(Buffer.from(invoice.fileData) as unknown as BodyInit, {
      headers: {
        "Content-Type": invoice.fileMimeType,
        "Content-Disposition": `inline; filename="${invoice.fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Supplier invoice download error:", error);
    return NextResponse.json({ error: "Failed to download invoice" }, { status: 500 });
  }
}
