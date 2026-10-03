import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PaymentTransactionStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { getIciciConfig, requestRefund } from "./icici-gateway.util";

// ICICI Bank Payment Gateway — UAT ONLY. Admin-only read visibility + refund
// (task §26/§27). NEVER returns ICICI_PG_SECRET_KEY, HMAC secrets, or
// merchant credentials — only the non-sensitive fields listed in the task's
// admin visibility requirement. Raw request/response JSON blobs
// (initiationRequest/statusResponse/etc) are intentionally NOT exposed via
// this service's list/detail serialization even though they're stored in the
// DB for audit purposes — they may contain gateway-internal fields that
// should stay server-side-only even for admin viewing, consistent with this
// repo's existing pattern of a dedicated, narrow serializer (see
// PaymentsService.serializeSummary for bank-transfer).
@Injectable()
export class IciciPaymentsService {
  private readonly logger = new Logger(IciciPaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const transactions = await this.prisma.paymentTransaction.findMany({
      include: {
        order: { select: { id: true, enquiryId: true, orderNumber: true, status: true } },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return transactions.map((t) => this.serialize(t));
  }

  async findOne(id: string) {
    const transaction = await this.prisma.paymentTransaction.findUnique({
      where: { id },
      include: {
        order: { select: { id: true, enquiryId: true, orderNumber: true, status: true } },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    if (!transaction) {
      throw new NotFoundException("No ICICI payment transaction found");
    }
    return this.serialize(transaction);
  }

  // Admin-only REFUND (task §27). Server-side only, amount-validated against
  // the actually-paid amount, and prevents a duplicate/excessive refund.
  async refund(id: string, actorId: string, refundAmount: number) {
    const config = getIciciConfig();
    if (!config) {
      throw new BadRequestException("ICICI online payment is not available/configured in this environment");
    }

    const transaction = await this.prisma.paymentTransaction.findUnique({ where: { id } });
    if (!transaction) {
      throw new NotFoundException("No ICICI payment transaction found");
    }

    if (transaction.status === PaymentTransactionStatus.REFUNDED) {
      throw new BadRequestException("This transaction has already been refunded");
    }
    if (transaction.status === PaymentTransactionStatus.REFUND_INITIATED) {
      throw new BadRequestException("A refund is already in progress for this transaction");
    }
    if (transaction.status !== PaymentTransactionStatus.SUCCESS) {
      throw new BadRequestException("Only a SUCCESS transaction can be refunded");
    }
    if (refundAmount <= 0 || refundAmount > Number(transaction.amount)) {
      throw new BadRequestException("Refund amount must be greater than zero and cannot exceed the paid amount");
    }
    if (!transaction.gatewayTxnId) {
      throw new BadRequestException("Missing gateway transaction id — cannot process refund");
    }

    await this.prisma.paymentTransaction.update({
      where: { id },
      data: { status: PaymentTransactionStatus.REFUND_INITIATED },
    });

    const result = await requestRefund(config, {
      merchantTxnNo: transaction.merchantTxnNo,
      refundAmount: refundAmount.toFixed(2),
      gatewayTxnId: transaction.gatewayTxnId,
    });

    const nextStatus = result.ok ? PaymentTransactionStatus.REFUNDED : PaymentTransactionStatus.REFUND_FAILED;

    const updated = await this.prisma.paymentTransaction.update({
      where: { id },
      data: {
        status: nextStatus,
        gatewayResponseDescription: result.ok ? "Refund processed via ICICI UAT" : result.error,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: result.ok ? "ICICI_REFUND_SUCCEEDED" : "ICICI_REFUND_FAILED",
        entityType: "PaymentTransaction",
        entityId: id,
        metadata: { orderId: transaction.orderId, refundAmount },
      },
    });

    this.logger.log(`ICICI UAT refund ${result.ok ? "succeeded" : "failed"} for transaction ${id}`);

    return this.findOne(updated.id);
  }

  private serialize(t: any) {
    return {
      id: t.id,
      orderId: t.orderId,
      enquiryId: t.order?.enquiryId ?? t.orderId,
      orderNumber: t.order?.orderNumber ?? null,
      orderStatus: t.order?.status,
      paymentReference: t.paymentReference,
      merchantTxnNo: t.merchantTxnNo,
      gateway: t.gateway,
      gatewayEnvironment: t.gatewayEnvironment,
      amount: Number(t.amount),
      currency: t.currency,
      status: t.status,
      gatewayTxnId: t.gatewayTxnId,
      gatewayTxnAuthId: t.gatewayTxnAuthId,
      paymentMode: t.paymentMode,
      secureHashVerified: t.secureHashVerified,
      customer: { id: t.user?.id, name: t.user?.name, email: t.user?.email, phone: t.user?.phone },
      initiatedAt: t.initiatedAt,
      completedAt: t.completedAt,
      failedAt: t.failedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}
