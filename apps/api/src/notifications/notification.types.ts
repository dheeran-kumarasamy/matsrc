import { NotificationChannel, NotificationTemplateType, OrderStatus } from "@matsrc/db";

export const NOTIFICATIONS_QUEUE_NAME = "notifications";
export const NOTIFICATION_PROVIDER = Symbol("NOTIFICATION_PROVIDER");

export type NotificationAudience = "supplier" | "builder";

export type NotificationJobData = {
  notificationId: string;
};

export type NotificationContent = {
  title: string;
  body: string;
};

export type NotificationTemplateContext = {
  orderId: string;
  orderNumber: string;
  enquiryId?: string;
  enquiryNumber?: string;
  deepLink?: string;
  supplierName?: string | null;
  builderName?: string | null;
  status?: OrderStatus;
  totalAmount?: number;
  bestPriceTotal?: number;
  tentativeDeliveryDate?: string;
  lineItemSummary?: string;
  itemCount?: number;
};

export type NotificationEnvelope = {
  userId: string;
  audience: NotificationAudience;
  channel: NotificationChannel;
  templateType: NotificationTemplateType;
  variables: NotificationTemplateContext;
  content: NotificationContent;
  idempotencyKey?: string;
};