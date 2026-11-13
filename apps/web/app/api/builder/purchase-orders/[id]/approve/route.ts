import { NextResponse } from "next/server";
import { PurchaseOrderStatus, notifySupplierPoReceived, OtpPurpose } from "@matsrc/db";
import { prisma, getOrCreateBuilder, getUserCtx } from "@/lib/builder-db";
import { serializePurchaseOrder, purchaseOrderInclude } from "@/lib/purchase-order-utils";
import { verifyOtpChallenge, checkOtpVerifyRateLimit } from "@/lib/otp-service";

export const dynamic = "force-dynamic";

// POST /api/builder/purchase-orders/[id]/approve
// OTP/in-app authenticated approval action = e-signature equivalent. Locks the PO,
// transitions Draft → Issued, writes a non-repudiable AuditLog entry (actor, timestamp,
// IP/device), and notifies the supplier in-app (best-effort, non-blocking).
//
// C37 fix: previously this only checked the OTP's syntactic shape
// (`/^\d{6}$/`), so ANY 6-digit number approved the PO regardless of whether
// an OTP was ever sent. Now verifies the actual, PO-scoped OtpChallenge
// issued by the new /send-otp endpoint — purpose=PO_APPROVAL_OTP, scoped to
// this specific purchaseOrderId, so an OTP issued for a different PO, a
// different user, or a LOGIN_OTP challenge can never approve this PO.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    const otp = typeof body.otp === "string" ? body.otp : "";
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json({ error: "A valid 6-digit OTP is required to approve this purchase order" }, { status: 400 });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: params.id, builderId: user.id },
      include: {
        supplier: { include: { user: true } },
        builder: true,
        lineItems: { include: { product: true } },
        order: { select: { enquiryId: true } },
      },
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    if (po.status !== PurchaseOrderStatus.DRAFT) {
      return NextResponse.json({ error: "Only draft purchase orders can be approved" }, { status: 400 });
    }

    if (!po.builder.email) {
      return NextResponse.json({ error: "No registered email on file for this account" }, { status: 400 });
    }

    const verifyRateLimit = checkOtpVerifyRateLimit(`${user.id}:${po.id}`, OtpPurpose.PO_APPROVAL_OTP);
    if (!verifyRateLimit.allowed) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }

    // Digital approval gate: real OTP verification, not a shape check.
    // Scoped to purpose + identifier (the builder's own registered email —
    // the same identifier /send-otp issued the challenge against) + this
    // exact purchaseOrderId.
    const verified = await verifyOtpChallenge(
      {
        purpose: OtpPurpose.PO_APPROVAL_OTP,
        identifier: po.builder.email,
        userId: user.id,
        purchaseOrderId: po.id,
      },
      otp
    );

    if (!verified.ok) {
      const status = verified.code === "NOT_FOUND" || verified.code === "EXPIRED" ? 400 : 401;
      return NextResponse.json({ error: verified.message }, { status });
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
          body: `PO ${po.poNumber} has been issued for enquiry ${po.order.enquiryId ?? po.orderId}. Please acknowledge in your supplier portal.`,
          context: { poId: po.id, poNumber: po.poNumber },
          idempotencyKey: `po-issued:${po.id}`,
        }),
      }).catch(() => undefined);
    } catch {
      // Notification delivery must never block PO issuance.
    }

    // Notification Engine — supplier_po_alert WhatsApp template
    // (SUPPLIER_PO_RECEIVED). Fires exactly once the PO has actually
    // transitioned DRAFT -> ISSUED above (never at PO creation/DRAFT). Uses
    // the shared, framework-agnostic notifySupplierPoReceived()
    // (packages/db/lib/supplier-po-received-notification.ts) since this
    // Next.js route cannot inject apps/api's NestJS
    // NotificationEngineService — same reasoning as
    // notifySupplierRfqReceived's call site in order-checkout.ts. This app
    // does not have @vercel/functions installed (unlike apps/api/apps/supplier),
    // so this mirrors the existing detached `void` fire-and-forget pattern
    // already used immediately above/elsewhere in this same route — never a
    // newly-invented async architecture.
    void notifySupplierPoReceived(prisma as any, { purchaseOrderId: po.id }, (message) => {
      console.log(`[supplier-po-received] ${message}`);
    }).catch((error) => {
      console.error(`Failed to send supplier_po_alert notification for purchaseOrder ${po.id}:`, error);
    });

    return NextResponse.json(serializePurchaseOrder(updated));
  } catch (error) {
    console.error("Purchase order approve error:", error);
    return NextResponse.json({ error: "Failed to approve purchase order" }, { status: 500 });
  }
}
