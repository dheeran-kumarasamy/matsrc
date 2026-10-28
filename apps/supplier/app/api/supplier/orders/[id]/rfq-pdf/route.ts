import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@matsrc/db";
import { ensureSupplierContext } from "@/lib/supplier-data";
import { renderRfqPdf, type RfqPdfData } from "@/lib/rfq-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/supplier/orders/[id]/rfq-pdf
//
// Download RFQ as PDF — Supplier Portal. Generated on demand from the
// authoritative, live Order/OrderItem/Product records (never a stored
// snapshot) — see the feature's Phase 1 investigation report.
//
// Authorization: possession of an order id alone is NOT sufficient — the
// order must have at least one OrderItem whose supplierId is the
// AUTHENTICATED supplier's own supplierProfile.id (mirrors
// getSupplierOrderDetail's / the supplier invoice download route's
// identical `where: { id, items: { some: { supplierId } } }` ownership
// scoping). An unrelated supplier changing the URL's order id simply gets
// no matching row (404), never another supplier's data — this correctly
// supports both the single-supplier and multi-supplier-candidate RFQ
// workflows without assuming every RFQ has exactly one supplier.
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
      select: {
        id: true,
        enquiryId: true,
        status: true,
        createdAt: true,
        deliveryAddress: true,
        deliveryDate: true,
        tentativeDeliveryDate: true,
        user: { select: { name: true, email: true, phone: true } },
        site: {
          select: { name: true, addressLine: true, city: true, state: true, pincode: true },
        },
        // Only THIS supplier's own line items are ever rendered — a
        // multi-supplier-candidate RFQ never leaks a competing supplier's
        // assigned line items to this supplier's download.
        items: {
          where: { supplierId: supplierProfile.id },
          select: {
            quantity: true,
            product: { select: { name: true, description: true, unit: true } },
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    }

    const data: RfqPdfData = {
      rfqNumber: order.enquiryId ?? order.id,
      createdAt: order.createdAt,
      status: order.status,
      builder: order.user ? { name: order.user.name, email: order.user.email, phone: order.user.phone } : null,
      site: order.site,
      // This document is ADDRESSED TO the requesting supplier — showing
      // their own identity back to themselves would be redundant, and
      // showing ANY other supplier's identity would leak competing-bid
      // information never authorized for disclosure. Always null here.
      supplier: null,
      deliveryAddress: order.deliveryAddress,
      deliveryDate: order.deliveryDate ?? order.tentativeDeliveryDate,
      notes: null,
      lineItems: order.items.map((item) => ({
        productName: item.product.name,
        description: item.product.description,
        quantity: item.quantity,
        unit: item.product.unit,
      })),
    };

    const buffer = await renderRfqPdf(data);
    const filename = `RFQ-${data.rfqNumber}`.replace(/[\\/]/g, "-") + ".pdf";

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Supplier RFQ PDF error:", error);
    return NextResponse.json({ error: "Failed to generate RFQ PDF" }, { status: 500 });
  }
}
