import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  NotificationChannel,
  NotificationTemplateType,
  OrderStatus,
} from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { NotificationQueueService } from "./notification.queue";
import {
  NotificationContent,
  NotificationEnvelope,
  NotificationTemplateContext,
  NOTIFICATION_PROVIDER,
} from "./notification.types";
import {
  NotificationProvider,
} from "./adapters/notification-provider.interface";

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: NotificationQueueService,
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider
  ) {}

  async notifySupplierOrderSubmitted(orderId: string): Promise<void> {
    const envelope = await this.buildOrderSubmittedEnvelope(orderId);
    if (!envelope) {
      return;
    }

    await this.enqueueEnvelope(envelope, "order-submitted");
  }

  async notifyBuilderBestPriceSelected(params: {
    enquiryId: string;
    bestPriceTotal: number;
    tentativeDeliveryDate: Date;
    selectedSupplierName?: string | null;
    selectedSupplierId?: string | null;
    lineItemSummary: string;
  }): Promise<void> {
    const envelope = await this.buildBuilderBestPriceEnvelope(params);
    if (!envelope) {
      return;
    }

    await this.enqueueEnvelope(envelope, "enquiry-best-price");
  }

  async notifyBuilderOrderDecision(orderId: string, status: OrderStatus): Promise<void> {
    const envelope = await this.buildOrderDecisionEnvelope(orderId, status);
    if (!envelope) {
      return;
    }

    await this.enqueueEnvelope(envelope, "order-decision");
  }

  async sendWhatsApp(params: {
    to: string;
    title: string;
    body: string;
    context?: Record<string, unknown>;
    idempotencyKey?: string;
  }) {
    return this.provider.sendWhatsAppMessage({
      to: params.to,
      title: params.title,
      body: params.body,
      context: params.context,
      idempotencyKey: params.idempotencyKey,
    });
  }

  async processNotification(notificationId: string, attempt = 1, maxAttempts = 3): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        user: {
          include: {
            notificationPreference: true,
          },
        },
      },
    });

    if (!notification) {
      return;
    }

    const preference = notification.user.notificationPreference;
    const isChannelEnabled = this.isChannelEnabled(preference, notification.channel);
    if (!isChannelEnabled) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: "skipped",
          retryCount: attempt - 1,
          failureReason: "Channel disabled by user preference",
        },
      });

      await this.prisma.notificationDeliveryLog.create({
        data: {
          notificationId,
          previousStatus: notification.status,
          newStatus: "skipped",
          provider: notification.channel.toLowerCase(),
          errorMessage: "Channel disabled by user preference",
        },
      });
      return;
    }

    const recipient = this.resolveRecipient(notification.user);
    if (!recipient) {
      await this.markNotificationFailed(notificationId, notification.status, attempt, maxAttempts, "No WhatsApp or phone number available");
      return;
    }

    const template = await this.resolveTemplate(notification.templateType, notification.channel, this.parseVariables(notification.variables));
    const content: NotificationContent = template ?? { title: notification.title, body: notification.body };

    try {
      const result = await this.provider.sendWhatsAppMessage({
        to: recipient,
        title: content.title,
        body: content.body,
        idempotencyKey: (notification as any).idempotencyKey ?? undefined,
        context: this.parseVariables(notification.variables),
      });

      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: "sent",
          externalId: result.externalId,
          failureReason: null,
          deliveredAt: new Date(),
          retryCount: attempt - 1,
        },
      });

      await this.prisma.notificationDeliveryLog.create({
        data: {
          notificationId,
          previousStatus: notification.status,
          newStatus: "sent",
          provider: result.provider,
          metadata: JSON.stringify({ recipient, attempt }),
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Notification delivery failed";
      await this.markNotificationFailed(notificationId, notification.status, attempt, maxAttempts, reason);
      if (attempt < maxAttempts) {
        throw error;
      }
    }
  }

  private async enqueueEnvelope(envelope: NotificationEnvelope, jobName: string): Promise<void> {
    if (envelope.idempotencyKey) {
      const existing = await this.prisma.notification.findFirst({
        where: { idempotencyKey: envelope.idempotencyKey } as any,
        select: { id: true },
      });

      if (existing) {
        return;
      }
    }

    const notification = await this.prisma.notification.create({
      data: {
        userId: envelope.userId,
        audience: envelope.audience,
        channel: envelope.channel,
        title: envelope.content.title,
        body: envelope.content.body,
        status: "queued",
        idempotencyKey: envelope.idempotencyKey ?? null,
        templateType: envelope.templateType,
        variables: JSON.stringify(envelope.variables),
        retryCount: 0,
      },
    });

    const queued = await this.queueService.enqueue(jobName, { notificationId: notification.id });
    if (!queued) {
      await this.processNotification(notification.id, 1, 1);
    }
  }

  private async buildOrderSubmittedEnvelope(orderId: string): Promise<NotificationEnvelope | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        items: {
          include: {
            product: true,
            supplier: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return null;
    }

    const supplierUser = order.items[0]?.supplier.user;
    if (!supplierUser) {
      return null;
    }

    const deepLink = this.getSupplierEnquiryDeepLink(order.id);
    const lineItemSummary = this.buildOrderLineItemSummary(
      order.items.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        unit: item.product.unit,
      }))
    );

    const content = {
      title: "New order received",
      body: `Enquiry ${order.id.slice(0, 8)} from ${order.user.name ?? order.user.phone ?? "a builder"}. Items: ${lineItemSummary}. Quote here: ${deepLink}`,
    };

    return {
      userId: supplierUser.id,
      audience: "supplier",
      channel: NotificationChannel.WHATSAPP,
      templateType: "ENQUIRY_SUBMITTED_TO_SUPPLIER" as NotificationTemplateType,
      variables: {
        orderId: order.id,
        orderNumber: order.id.slice(0, 8),
        enquiryId: order.id,
        enquiryNumber: order.id.slice(0, 8),
        deepLink,
        builderName: order.user.name ?? order.user.phone,
        itemCount: order.items.length,
        lineItemSummary,
        totalAmount: Number(order.totalAmount),
      },
      content,
      idempotencyKey: `supplier-enquiry:${order.id}:${supplierUser.id}`,
    };
  }

  private async buildBuilderBestPriceEnvelope(params: {
    enquiryId: string;
    bestPriceTotal: number;
    tentativeDeliveryDate: Date;
    selectedSupplierName?: string | null;
    selectedSupplierId?: string | null;
    lineItemSummary: string;
  }): Promise<NotificationEnvelope | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: params.enquiryId },
      include: {
        user: true,
      },
    });

    if (!order) {
      return null;
    }

    const deepLink = this.getBuilderEnquiryDeepLink(order.id);
    const tentativeDeliveryDate = params.tentativeDeliveryDate.toISOString().slice(0, 10);
    const bestPriceLabel = Number(params.bestPriceTotal).toLocaleString("en-IN", { maximumFractionDigits: 2 });

    return {
      userId: order.userId,
      audience: "builder",
      channel: NotificationChannel.WHATSAPP,
      templateType: "ENQUIRY_BEST_PRICE_TO_BUILDER" as NotificationTemplateType,
      variables: {
        orderId: order.id,
        orderNumber: order.id.slice(0, 8),
        enquiryId: order.id,
        enquiryNumber: order.id.slice(0, 8),
        supplierName: params.selectedSupplierName ?? null,
        bestPriceTotal: params.bestPriceTotal,
        tentativeDeliveryDate,
        deepLink,
        lineItemSummary: params.lineItemSummary,
      },
      content: {
        title: "Best quote ready",
        body: `Enquiry ${order.id.slice(0, 8)} accepted. Best price: INR ${bestPriceLabel}. Tentative delivery: ${tentativeDeliveryDate}. Details: ${deepLink}`,
      },
      idempotencyKey: `builder-best-price:${order.id}`,
    };
  }

  private async buildOrderDecisionEnvelope(orderId: string, status: OrderStatus): Promise<NotificationEnvelope | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        items: {
          include: {
            supplier: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return null;
    }

    const statusConfig = this.getDecisionStatusConfig(status);
    const content = {
      title: statusConfig.title,
      body: statusConfig.body(order.user.name ?? order.user.phone ?? "your order", order.items[0]?.supplier.companyName ?? "Supplier"),
    };

    return {
      userId: order.userId,
      audience: "builder",
      channel: NotificationChannel.WHATSAPP,
      templateType: statusConfig.templateType,
      variables: {
        orderId: order.id,
        orderNumber: order.id.slice(0, 8),
        supplierName: order.items[0]?.supplier.companyName,
        builderName: order.user.name ?? order.user.phone,
        status,
        itemCount: order.items.length,
        totalAmount: Number(order.totalAmount),
      },
      content,
    };
  }

  private getDecisionStatusConfig(status: OrderStatus): {
    templateType: NotificationTemplateType;
    title: string;
    body: (builderLabel: string, supplierLabel: string) => string;
  } {
    if (status === OrderStatus.PROCESSING) {
      return {
        templateType: NotificationTemplateType.ORDER_ACCEPTED,
        title: "Order accepted",
        body: (builderLabel, supplierLabel) => `${supplierLabel} has accepted ${builderLabel}'s order and is preparing the shipment.`,
      };
    }

    if (status === OrderStatus.CANCELLED) {
      return {
        templateType: NotificationTemplateType.ORDER_DECLINED,
        title: "Order declined",
        body: (builderLabel, supplierLabel) => `${supplierLabel} has declined ${builderLabel}'s order.`,
      };
    }

    if (status === OrderStatus.DISPATCHED) {
      return {
        templateType: NotificationTemplateType.ORDER_DISPATCHED,
        title: "Order dispatched",
        body: (builderLabel, supplierLabel) => `${supplierLabel} marked ${builderLabel}'s order as dispatched.`,
      };
    }

    if (status === OrderStatus.OUT_FOR_DELIVERY) {
      return {
        templateType: NotificationTemplateType.ORDER_OUT_FOR_DELIVERY,
        title: "Order out for delivery",
        body: (builderLabel, supplierLabel) => `${supplierLabel} marked ${builderLabel}'s order as out for delivery.`,
      };
    }

    return {
      templateType: NotificationTemplateType.ORDER_DELIVERED,
      title: "Order delivered",
      body: (builderLabel, supplierLabel) => `${supplierLabel} marked ${builderLabel}'s order as delivered.`,
    };
  }

  private resolveRecipient(user: { whatsappNumber: string | null; phone: string | null }): string | null {
    return user.whatsappNumber?.trim() || user.phone?.trim() || null;
  }

  private isChannelEnabled(
    preference: { whatsappEnabled: boolean; smsEnabled: boolean; emailEnabled: boolean; pushEnabled: boolean; inAppEnabled: boolean } | null,
    channel: NotificationChannel
  ): boolean {
    if (!preference) {
      return true;
    }

    if (channel === NotificationChannel.WHATSAPP) {
      return preference.whatsappEnabled;
    }

    if (channel === NotificationChannel.SMS) {
      return preference.smsEnabled;
    }

    if (channel === NotificationChannel.EMAIL) {
      return preference.emailEnabled;
    }

    if (channel === NotificationChannel.PUSH) {
      return preference.pushEnabled;
    }

    return preference.inAppEnabled;
  }

  private parseVariables(serializedVariables: string | null): NotificationTemplateContext {
    if (!serializedVariables) {
      return {
        orderId: "",
        orderNumber: "",
      };
    }

    try {
      return JSON.parse(serializedVariables) as NotificationTemplateContext;
    } catch {
      return {
        orderId: "",
        orderNumber: "",
      };
    }
  }

  private async resolveTemplate(
    templateType: NotificationTemplateType | null,
    channel: NotificationChannel,
    variables: NotificationTemplateContext
  ): Promise<NotificationContent | null> {
    if (!templateType) {
      return null;
    }

    const template = await this.prisma.notificationTemplate.findFirst({
      where: {
        type: templateType,
        channel,
        active: true,
      },
      orderBy: {
        version: "desc",
      },
    });

    if (!template) {
      return null;
    }

    return {
      title: this.interpolateTemplate(template.title, variables),
      body: this.interpolateTemplate(template.body, variables),
    };
  }

  private interpolateTemplate(value: string, variables: NotificationTemplateContext): string {
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: keyof NotificationTemplateContext) => {
      const replacement = variables[key];
      return replacement === undefined || replacement === null ? "" : String(replacement);
    });
  }

  private getSupplierEnquiryDeepLink(enquiryId: string): string {
    const baseUrl = process.env.SUPPLIER_PORTAL_URL || process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";
    return `${baseUrl.replace(/\/$/, "")}/rfqs?respond=${enquiryId}`;
  }

  private getBuilderEnquiryDeepLink(enquiryId: string): string {
    const baseUrl = process.env.BUILDER_PORTAL_URL || process.env.NEXT_PUBLIC_APP_URL || "https://web-sable-nine-97.vercel.app";
    return `${baseUrl.replace(/\/$/, "")}/orders/${enquiryId}`;
  }

  private buildOrderLineItemSummary(items: Array<{ name: string; quantity: number; unit?: string | null }>): string {
    if (!items.length) {
      return "No items";
    }

    const summary = items.slice(0, 3).map((item) => `${item.name} (${item.quantity}${item.unit ? ` ${item.unit}` : ""})`);
    if (items.length > 3) {
      summary.push(`+${items.length - 3} more`);
    }

    return summary.join(", ");
  }

  private async markNotificationFailed(
    notificationId: string,
    previousStatus: string,
    attempt: number,
    maxAttempts: number,
    failureReason: string
  ): Promise<void> {
    const nextStatus = attempt >= maxAttempts ? "failed" : "queued";

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: nextStatus,
        retryCount: attempt,
        failureReason,
        failedAt: nextStatus === "failed" ? new Date() : null,
      },
    });

    await this.prisma.notificationDeliveryLog.create({
      data: {
        notificationId,
        previousStatus,
        newStatus: nextStatus,
        provider: "mock-whatsapp",
        errorMessage: failureReason,
        metadata: JSON.stringify({ attempt, maxAttempts }),
      },
    });
  }
}