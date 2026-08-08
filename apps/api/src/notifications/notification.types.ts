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
  // NOTE: orderId/orderNumber are historically required fields on this
  // shared context type. Phase 6D (Watchlist Price Alerts) does not have an
  // order — callers of notifyWatchlistPriceAlert pass a stable placeholder
  // (the watchlistId) so existing template-interpolation code paths that
  // reference {{orderId}}/{{orderNumber}} continue to work unchanged for
  // every other notification type without needing a schema/type-breaking
  // change here.
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
  // Order Aggregation ("Group & Save") template variables
  poolId?: string;
  productName?: string;
  quantity?: number;
  currentUnitPrice?: number;
  previousUnitPrice?: number;
  lockedUnitPrice?: number;
  savingsEstimate?: number;
  windowCloseAt?: string;
  hoursRemaining?: number;
  // Phase 6D: Watchlist Price Alert template variables (UF-09 bridge to
  // Price Intelligence). All optional/additive.
  watchlistId?: string;
  targetPrice?: number;
  districtName?: string;
  confidence?: string;
  method?: string;
  methodLabel?: string;
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
