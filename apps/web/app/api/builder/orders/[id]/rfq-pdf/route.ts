import { NextResponse } from "next/server";
import { prisma, getOrCreateBuilder, resolveUserCtx } from "@/lib/builder-db";
import { renderRfqPdf, type RfqPdfData } from "@/lib/rfq-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/builder/orders/[id]/rfq-pdf
//
// Download RFQ as PDF — Builder Portal. Generated on demand from the
// authoritative, live Order/OrderItem/Product records (never a stored
// snapshot) — see the feature's Phase 1 investigation report. Ownership is
// enforced by the SAME `where: { id, userId: user.id }` scoping every other
// builder order route in this file uses (see
// app/api/builder/orders/[id]/route.ts) — a builder can never download
// another builder's RFQ by changing the URL's order id, since a mismatched
// id simply yields no row and a 404, never another builder's data.
//
// Uses resolveUserCtx() (not the plain getUserCtx()) because this route is
// hit via a plain <a href> browser download link (see
// app/(builder)/orders/[id]/page.tsx's "Download RFQ PDF" button) rather
// than the fetch-based builderApi* helpers — a direct browser navigation
// never attaches the custom X-User-Id/X-User-Email headers getUserCtx()
// requires, only the NextAuth session cookie. resolveUserCtx() falls back
// to that cookie when the custom headers are absent, mirroring the
// purchase-order export route's identical fix for the same class of bug.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const order = await prisma.order.findFirst({
      where: { id: params.id, userId: user.id },
      select: {
        id: true,
        enquiryId: true,
        status: true,
        createdAt: true,
        deliveryAddress: true,
        deliveryDate: true,
        tentativeDeliveryDate: true,
        site: {
          select: { name: true, addressLine: true, city: true, state: true, pincode: true },
        },
        items: {
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

    // Identity privacy: neither the builder's own identity nor any
    // supplier's identity is ever included — the requester is represented
    // only by its Site name, and the counterparty is always rendered as
    // "BuildOhub" inside renderRfqPdf itself (see rfq-pdf.ts's RfqPdfData
    // doc comment). There is deliberately no `builder`/`supplier` field on
    // RfqPdfData to populate here.
    const data: RfqPdfData = {
      rfqNumber: order.enquiryId ?? order.id,
      createdAt: order.createdAt,
      status: order.status,
      site: order.site,
      deliveryAddress: order.deliveryAddress,
      deliveryDate: order.deliveryDate ?? order.tentativeDeliveryDate,
      // No RFQ-level notes field exists on Order itself — never
      // substituted with a SupplierQuote's own quotation remarks.
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
  } catch (error: any) {
    // resolveUserCtx() throws "UNAUTHENTICATED" if there's no valid session
    // cookie (e.g. an expired/missing login) — map that to a clean 401
    // rather than falling through to the generic 500 below, mirroring every
    // other resolveUserCtx()/getUserCtx() consumer in this app (see
    // app/api/builder/purchase-orders/[id]/export/route.ts's identical
    // handling).
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Builder RFQ PDF error:", error);
    return NextResponse.json({ error: "Failed to generate RFQ PDF" }, { status: 500 });
  }
}
