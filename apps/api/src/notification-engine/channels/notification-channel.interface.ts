export type NotificationPayload = {
  recipientId: string;
  phone?: string | null;
  templateName: string;
  parameters: string[];
  deepLink?: string;
  title?: string;
  body?: string;
  /**
   * Optional dynamic suffix for an approved Meta WhatsApp URL button (e.g.
   * "payment_required_v2"'s "Complete Payment" button, approved fixed prefix
   * `https://buildohub.in/orders/payment/{{1}}` — this is only the bare
   * `orderId` suffix, never the full URL and never a `payment/{orderId}`
   * value, since `/payment/` is already part of the approved fixed prefix).
   * Only the WhatsApp channel consumes this; other channels (e.g. In-App)
   * ignore it. Omitted entirely for every template without a dynamic URL
   * button — purely additive.
   */
  buttonUrlSuffix?: string;
};

export type NotificationResult = {
  success: boolean;
  externalId?: string;
  error?: string;
};

/**
 * Channel abstraction (spec Phase 4). Every outbound channel (WhatsApp,
 * In-App, and — later — Email) implements this single interface so the
 * NotificationEngineService never depends on a specific channel's transport
 * details. Adding Email later means adding one more class implementing this
 * interface plus a dispatch-table entry; no other code changes.
 */
export interface NotificationChannel {
  send(notification: NotificationPayload): Promise<NotificationResult>;
}
