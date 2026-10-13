import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { prisma, getOrCreateBuilder, resolveUserCtx } from "@/lib/builder-db";
import { useRupeeCapableFont } from "@/lib/pdf-fonts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function money(value: number, currency: string): string {
  return `${currency === "INR" ? "\u20B9" : currency + " "}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

type ReceiptPdfData = {
  receiptNumber: string;
  issuedAt: Date;
  amount: number;
  balanceAfter: number;
  currency: string;
  paymentMethod: string | null;
  paymentReferenceNo: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerPhone: string | null;
  advancePaymentReference: string | null;
};

// Renders the FROZEN AdvanceReceipt snapshot (never live account state) as a
// PDF buffer — mirrors the existing builder order-invoice PDF route
// (apps/web/app/api/builder/orders/[id]/invoice/pdf/route.ts) exactly, so
// this route reuses the same pdfkit rendering convention rather than
// introducing a second document-generation approach.
function renderReceiptPdf(receipt: ReceiptPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    useRupeeCapableFont(doc);

    doc.fontSize(18).text("Buildohub");
    doc.fontSize(12).fillColor("#64748b").text("Advance Payment Receipt").fillColor("#0f172a");

    doc.moveDown();
    doc.fontSize(14).text(`Receipt No: ${receipt.receiptNumber}`);
    doc
      .fontSize(10)
      .fillColor("#64748b")
      .text(`Issued: ${receipt.issuedAt.toLocaleString("en-IN")}`)
      .fillColor("#0f172a");

    doc.moveDown();
    doc.fontSize(12).text("Buyer Details", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(`Name: ${receipt.buyerName ?? "-"}`);
    doc.text(`Email: ${receipt.buyerEmail ?? "-"}`);
    doc.text(`Phone: ${receipt.buyerPhone ?? "-"}`);

    doc.moveDown();
    doc.fontSize(12).text("Payment Details", { underline: true });
    doc.moveDown(0.3);
    if (receipt.advancePaymentReference) {
      doc.fontSize(10).text(`Advance Payment Reference: ${receipt.advancePaymentReference}`);
    }
    if (receipt.paymentReferenceNo) {
      doc.fontSize(10).text(`Payment/UTR Reference: ${receipt.paymentReferenceNo}`);
    }
    if (receipt.paymentMethod) {
      doc.fontSize(10).text(`Payment Method: ${receipt.paymentMethod}`);
    }

    doc.moveDown();
    doc.fontSize(12).text(`Amount Received: ${money(receipt.amount, receipt.currency)}`, { align: "right" });
    doc.fontSize(10).fillColor("#64748b").text(`Available Advance Balance after this receipt: ${money(receipt.balanceAfter, receipt.currency)}`, {
      align: "right",
    });
    doc.fillColor("#0f172a");

    doc.moveDown(2);
    doc
      .fontSize(8)
      .fillColor("#94a3b8")
      .text(
        "This is a system-generated receipt confirming settlement of your Buildohub Advance Balance deposit. It does not constitute a GST tax invoice.",
        { align: "left" }
      );

    doc.end();
  });
}

// GET /api/builder/advance/receipts/[id]/pdf
//
// Buyer-facing PDF download of their own settled Advance Payment Receipt.
// Built entirely from the stored AdvanceReceipt snapshot (never live
// account/ledger state), so downloading always reproduces the same issued
// document. Strictly scoped to the authenticated buyer's own receipt — a
// buyer can never download another buyer's receipt (404, not 403, to avoid
// leaking existence of another buyer's receipt id).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const receipt = await prisma.advanceReceipt.findFirst({
      where: { id: params.id, buyerId: user.id },
      include: { advancePayment: { select: { referenceNumber: true } } },
    });
    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    const buffer = await renderReceiptPdf({
      receiptNumber: receipt.receiptNumber,
      issuedAt: receipt.issuedAt,
      amount: Number(receipt.amount),
      balanceAfter: Number(receipt.balanceAfter),
      currency: receipt.currency,
      paymentMethod: receipt.paymentMethod,
      paymentReferenceNo: receipt.paymentReferenceNo,
      buyerName: receipt.buyerName,
      buyerEmail: receipt.buyerEmail,
      buyerPhone: receipt.buyerPhone,
      advancePaymentReference: receipt.advancePayment?.referenceNumber ?? null,
    });

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${receipt.receiptNumber.replace(/\//g, "-")}.pdf"`,
        // Never cached/publicly stored — this is a sensitive financial
        // document. Mirrors the existing convention used for payment
        // screenshots/invoice PDFs served to admins (e.g.
        // apps/admin/app/api/admin/orders/[orderId]/invoice/pdf/route.ts).
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: any) {
    // This route is hit via a plain <a href> download link (not a
    // fetch()-based builderApi* call), so resolveUserCtx() falls back to
    // the NextAuth session cookie (see lib/builder-db.ts) and throws
    // "UNAUTHENTICATED" if that session check fails (expired/missing
    // cookie) — mirrors the existing purchase-order export route's error
    // handling for the exact same scenario.
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Advance receipt PDF error:", error);
    return NextResponse.json({ error: "Failed to generate receipt PDF" }, { status: 500 });
  }
}
