import { prisma } from "@/lib/builder-db";
import { sendWhatsAppMessage } from "@/lib/twilio-whatsapp";

// Buildohub Advance Balance notifications — mirrors notifyPaymentProofSubmitted's
// pattern exactly (idempotency key + Notification row + real Twilio send),
// reusing the SAME existing notification infrastructure as the order
// bank-transfer payment-proof flow (see apps/web/lib/notify.ts). No new
// notification system is introduced.
//
// Mirrors the existing convention (see notifyPaymentProofSubmitted) of only
// notifying the BUYER — the existing payment-proof flow has no separate
// "notify admin" channel either; admins see new submissions via the
// always-visible Admin Advance Payments queue (apps/admin), exactly as they
// already do for order payment-verification.
export async function notifyAdvancePaymentSubmitted(advancePaymentId: string): Promise<void> {
  try {
    const payment = await prisma.advancePayment.findUnique({
      where: { id: advancePaymentId },
      include: { buyer: true },
    });
    if (!payment) return;

    const idempotencyKey = `advance-payment-submitted:${payment.id}`;
    const existing = await prisma.notification.findFirst({ where: { idempotencyKey }, select: { id: true } });
    if (existing) return;

    const title = "Advance payment submitted";
    const body = `Your advance payment of ₹${Number(payment.amount).toLocaleString("en-IN")} has been submitted for verification. Reference: ${payment.referenceNumber}`;

    const notification = await prisma.notification.create({
      data: {
        userId: payment.buyerId,
        audience: "builder",
        channel: "WHATSAPP",
        title,
        body,
        status: "queued",
        idempotencyKey,
        variables: JSON.stringify({ advancePaymentId: payment.id, referenceNumber: payment.referenceNumber, amount: Number(payment.amount) }),
        retryCount: 0,
      },
    });

    const recipient = payment.buyer.whatsappNumber?.trim() || payment.buyer.phone?.trim();
    const result = recipient
      ? await sendWhatsAppMessage(recipient, body)
      : { error: "Customer has no WhatsApp/phone number on file" };

    const success = "externalId" in result;
    await prisma.notification.update({
      where: { id: notification.id },
      data: success
        ? { status: "sent", externalId: result.externalId, deliveredAt: new Date() }
        : { status: "failed", failureReason: result.error, failedAt: new Date() },
    });

    await prisma.notificationDeliveryLog.create({
      data: {
        notificationId: notification.id,
        previousStatus: "queued",
        newStatus: success ? "sent" : "failed",
        provider: "twilio-whatsapp",
        errorMessage: success ? null : result.error,
        metadata: JSON.stringify({ recipient }),
      },
    });
  } catch (error) {
    console.error("notifyAdvancePaymentSubmitted error:", error);
  }
}
