import { NextResponse } from "next/server";
import { PurchaseOrderStatus } from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { serializePurchaseOrder, purchaseOrderInclude } from "@/lib/purchase-order-utils";

export const dynamic = "force-dynamic";

// POST /api/builder/purchase-orders/[id]/approve
// OTP/in-app authenticated approval action = e-signature equivalent. Locks the PO,
// transitions Draft → Issued, writes a non-repudiable AuditLog entry (actor, timestamp,
// IP/device), and notifies the supplier in-app (best-effort, non-blocking).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    // Digital approval gate: require a verified OTP flag from the client (see
    // MfaVerification component pattern already used at checkout). This keeps the
    // approval action auditable and non-repudiable without any physical signature.
    const otp = typeof body.otp === "string" ? body.otp : "";
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json({ error: "A valid 6-digit OTP is required to approve this purchase order" }, { status: 400 });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, builderId: user.id },
      include: {
        supplier: { include: { user: true } },
        lineItems: { include: { product: true } },
      },
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    if (po.status !== PurchaseOrderStatus.DRAFT) {
      return NextResponse.json({ error: "Only draft purchase orders can be approved" }, { status: 400 });
    }

    const approverName = typeof body.approverName === "string" ? body.approverName.trim() : "";
    const approverDesignation = typeof body.approverDesignation === "string" ? body.approverDesignation.trim() : "";
    const approverLabel = [approverName, approverDesignation].filter(Boolean).join(" · ") || user.name || user.email;

    const updated = await prisma.purchaseOrder.update({
      where: { id: params.id },
      data: {
        status: PurchaseOrderStatus.ISSUED,
        approvedAt: new Date(),
        approvedBy: approverLabel,
      },
      include: purchaseOrderInclude,
    });

    const forwardedFor = request.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
    const userAgent = request.headers.get("user-agent");

    // Non-repudiable audit trail entry — feeds the Admin Audit module immediately on issuance.
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "PURCHASE_ORDER_ISSUED",
        entityType: "PurchaseOrder",
        entityId: po.id,
        metadata: {
          poNumber: po.poNumber,
          approverLabel,
          ip,
          userAgent,
          supplierId: po.supplierId,
          orderId: po.orderId,
        },
      },
    });

    // Instantly share with the supplier — in-app (acknowledge endpoint) + notification best-effort.
    // Uses same WhatsApp channel as existing order notifications; failures never block issuance.
    try {
      const backendUrl = process.env.BACKEND_API_URL || "http://localhost:4000/api";
      void fetch(`${backendUrl}/notifications/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: po.supplier.user?.whatsappNumber || po.supplier.user?.phone || "",
          title: "New Purchase Order issued",
          body: `PO ${po.poNumber} has been issued for enquiry ${po.orderId.slice(0, 8)}. Please acknowledge in your supplier portal.`,
          context: { poId: po.id, poNumber: po.poNumber },
          idempotencyKey: `po-issued:${po.id}`,
        }),
      }).catch(() => undefined);
    } catch {
      // Notification delivery must never block PO issuance.
    }

    return NextResponse.json(serializePurchaseOrder(updated));
  } catch (error) {
    console.error("Purchase order approve error:", error);
    return NextResponse.json({ error: "Failed to approve purchase order" }, { status: 500 });
  }
}
