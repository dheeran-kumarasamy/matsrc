export type NotificationPayload = {
  recipientId: string;
  phone?: string | null;
  templateName: string;
  parameters: string[];
  deepLink?: string;
  title?: string;
  body?: string;
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
