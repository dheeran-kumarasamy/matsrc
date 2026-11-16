// packages/db/lib/quote-received-notification.ts
//
// Shared, framework-agnostic implementation of the `quote_received` WhatsApp
// notification (Meta WhatsApp Cloud API, Notification Engine pipeline) — fired
// immediately after a supplier submits an RFQ quotation (one or more
// SupplierQuote rows created for an enquiry).
//
// WHY THIS LIVES IN packages/db:
// In production, quotation submission occurs both via the NestJS API (apps/api)
// and directly through the Next.js Supplier Portal (apps/supplier/lib/supplier-data.ts
// createSupplierQuote -> createEnquiryLineQuotesForSupplier). apps/supplier has
// direct Prisma access and cannot inject NestJS services. Placing this here
// provides a single, authoritative, shared implementation for both apps that
// uses the existing Notification Engine tables (NotificationEventPolicy,
// NotificationEvent, WhatsAppMessageLog, Notification).
//
// Event type: QUOTE_RECEIVED (channel: WHATSAPP), Meta Template ID 1055000930652376.
// Template contract:
//   Body: "A supplier has submitted a quotation for your requirement {{1}}.
//          Material: {{2}}. Quantity: {{3}}. Please review the quotation on Buildohub."
//   Parameters: [enquiryDisplayId, material, quantity]
//   URL Button: dynamic suffix {{1}} = order.id (fixed prefix: https://buildohub.in/orders/{{1}})
//
// Also writes an in-app Alert bell Notification (table: Notification) for the buyer.
// Never throws — failures are logged and caught so notification issues never
// roll back quotation persistence.

export type NotifyQuoteReceivedParams = {
  enquiryId: string;
  supplierId: string;
  quoteIds: string[];
};

export type QuoteReceivedNotificationPrismaClient = {
  order: { findUnique: (args: any) => Promise<any> };
  supplierQuote: { findMany: (args: any) => Promise<any> };
  notificationEventPolicy: { findUnique: (args: any) => Promise<any> };
  notificationGlobalSettings: { findUnique: (args: any) => Promise<any> };
  notificationPreference: { findUnique: (args: any) => Promise<any> };
  notificationEvent: {
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  whatsAppMessageLog: {
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  notification: {
    findFirst: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
};

const EVENT_TYPE = "QUOTE_RECEIVED";
const CHANNEL = "WHATSAPP";
const MAX_SUMMARY_ITEMS = 3;

export type QuoteReceivedWhatsAppMode = "live" | "dry-run" | "off";

export function getQuoteReceivedWhatsAppMode(): QuoteReceivedWhatsAppMode {
  if (process.env.VERCEL_ENV === "preview") {
    return "dry-run";
  }
  const raw = (process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE || "dry-run").toLowerCase();
  if (raw === "live" || raw === "off") return raw;
  return "dry-run";
}

function getPhoneNumberId(): string | undefined {
  return process.env.WHATSAPP_PHONE_NUMBER_ID;
}

function getAccessToken(): string | undefined {
  return process.env.WHATSAPP_ACCESS_TOKEN;
}

function getTemplateLanguage(): string {
  return process.env.WHATSAPP_TEMPLATE_LANGUAGE || process.env.WHATSAPP_TEMPLATE_LANGUAGE_CODE || "en";
}

function getGraphApiVersion(): string {
  return process.env.WHATSAPP_GRAPH_API_VERSION || "v20.0";
}

function getEndpoint(): string {
  return `https://graph.facebook.com/${getGraphApiVersion()}/${getPhoneNumberId()}/messages`;
}

type MetaGraphErrorBody = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

function maskPhone(phone: string): string {
  if (phone.length <= 4) return "***";
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

function formatMetaError(status: number, body: MetaGraphErrorBody): string {
  const err = body.error;
  if (!err) return `Meta Cloud API error (HTTP ${status})`;
  return `Meta Cloud API error (HTTP ${status}, code=${err.code ?? "n/a"}, subcode=${err.error_subcode ?? "n/a"}): ${err.message ?? "unknown"}`;
}

export function summarizeQuoteMaterials(
  quotes: Array<{ lineItem?: { product?: { name?: string | null } | null } | null }>
): string {
  if (!quotes.length) return "your requested material";
  const names = quotes
    .map((q) => q.lineItem?.product?.name?.trim())
    .filter((n): n is string => Boolean(n));
  const uniqueNames = Array.from(new Set(names));
  if (!uniqueNames.length) return "your requested material";
  const displayed = uniqueNames.slice(0, MAX_SUMMARY_ITEMS);
  if (uniqueNames.length > MAX_SUMMARY_ITEMS) {
    displayed.push(`+${uniqueNames.length - MAX_SUMMARY_ITEMS} more`);
  }
  return displayed.join(", ");
}

export function summarizeQuoteQuantities(
  quotes: Array<{ lineItem?: { quantity: any; product?: { unit?: string | null } | null } | null }>
): string {
  if (!quotes.length) return "—";
  const summary = quotes.slice(0, MAX_SUMMARY_ITEMS).map((q) => {
    const qty = q.lineItem?.quantity ?? "—";
    const unit = q.lineItem?.product?.unit ? ` ${q.lineItem.product.unit}` : "";
    return `${qty}${unit}`;
  });
  if (quotes.length > MAX_SUMMARY_ITEMS) {
    summary.push(`+${quotes.length - MAX_SUMMARY_ITEMS} more`);
  }
  return summary.join(", ");
}

async function sendTemplateViaMeta(
  prisma: QuoteReceivedNotificationPrismaClient,
  phone: string,
  templateName: string,
  parameters: string[],
  log: (message: string) => void,
  buttonUrlSuffix?: string
): Promise<{ success: boolean; externalId?: string; error?: string }> {
  const mode = getQuoteReceivedWhatsAppMode();

  const logRow = await prisma.whatsAppMessageLog.create({
    data: { phoneNumber: phone, templateName, direction: "outbound", status: "queued", parameters, mode },
  });

  if (mode === "off") {
    await prisma.whatsAppMessageLog.update({
      where: { id: logRow.id },
      data: { status: "failed", errorDetails: "DISABLED_BY_CHANNEL" },
    });
    return { success: false, error: "DISABLED_BY_CHANNEL" };
  }

  if (mode === "dry-run") {
    const mockMessageId = `mock-wa-${logRow.id}`;
    await prisma.whatsAppMessageLog.update({
      where: { id: logRow.id },
      data: { status: "sent", metaMessageId: mockMessageId },
    });
    log(`[dry-run] Simulated WhatsApp send template=${templateName} to=${maskPhone(phone)} mockMessageId=${mockMessageId}`);
    return { success: true, externalId: mockMessageId };
  }

  try {
    const phoneNumberId = getPhoneNumberId();
    const accessToken = getAccessToken();
    if (!phoneNumberId || !accessToken) {
      const errorDetails = "WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN not configured";
      await prisma.whatsAppMessageLog.update({ where: { id: logRow.id }, data: { status: "failed", errorDetails } });
      return { success: false, error: errorDetails };
    }

    const components = [
      ...(parameters.length > 0
        ? [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }]
        : []),
      ...(buttonUrlSuffix
        ? [{ type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: buttonUrlSuffix }] }]
        : []),
    ];

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: getTemplateLanguage() },
        ...(components.length > 0 ? { components } : {}),
      },
    };

    const response = await fetch(getEndpoint(), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const body = (await response.json()) as { messages?: Array<{ id: string }> };
      const metaMessageId = body.messages?.[0]?.id;
      await prisma.whatsAppMessageLog.update({ where: { id: logRow.id }, data: { status: "sent", metaMessageId } });
      return { success: true, externalId: metaMessageId };
    }

    const errorBody = (await response.json().catch(() => ({}))) as MetaGraphErrorBody;
    const errorDetails = formatMetaError(response.status, errorBody);
    log(`[meta-whatsapp] Send to ${maskPhone(phone)} failed: ${errorDetails}`);
    await prisma.whatsAppMessageLog.update({ where: { id: logRow.id }, data: { status: "failed", errorDetails } });
    return { success: false, error: errorDetails };
  } catch (error) {
    const errorDetails = error instanceof Error ? error.message : "Unknown WhatsApp send error";
    log(`[meta-whatsapp] Network error sending to ${maskPhone(phone)}: ${errorDetails}`);
    await prisma.whatsAppMessageLog
      .update({ where: { id: logRow.id }, data: { status: "failed", errorDetails } })
      .catch(() => undefined);
    return { success: false, error: errorDetails };
  }
}

async function evaluatePolicy(
  prisma: QuoteReceivedNotificationPrismaClient,
  recipientId: string,
  dedupeKey: string
): Promise<{ allowed: true; templateName: string } | { allowed: false; reason: string }> {
  const policy = await prisma.notificationEventPolicy.findUnique({
    where: { eventType_channel: { eventType: EVENT_TYPE, channel: CHANNEL } },
  });

  if (!policy) {
    return { allowed: false, reason: "TEMPLATE_NOT_FOUND" };
  }
  if (!policy.enabled) {
    return { allowed: false, reason: "TEMPLATE_DISABLED" };
  }

  const global = await prisma.notificationGlobalSettings.findUnique({ where: { id: "global" } });
  if (global && !global.whatsappBusinessEnabled) {
    return { allowed: false, reason: "CHANNEL_DISABLED_GLOBALLY" };
  }

  const preference = await prisma.notificationPreference.findUnique({ where: { userId: recipientId } });
  if (preference && preference.whatsappEnabled === false) {
    return { allowed: false, reason: "USER_OPTED_OUT" };
  }

  const existing = await prisma.notificationEvent.findUnique({ where: { dedupeKey } });
  if (existing) {
    return { allowed: false, reason: "DUPLICATE_DEDUPE_KEY" };
  }

  return { allowed: true, templateName: policy.templateName };
}

export async function notifyQuoteReceived(
  prisma: QuoteReceivedNotificationPrismaClient,
  params: NotifyQuoteReceivedParams,
  onLog: (message: string) => void = () => undefined
): Promise<void> {
  const { enquiryId, supplierId, quoteIds } = params;

  if (!quoteIds || quoteIds.length === 0) {
    return;
  }

  try {
    const [order, quotes] = await Promise.all([
      prisma.order.findUnique({
        where: { id: enquiryId },
        include: { user: true },
      }),
      prisma.supplierQuote.findMany({
        where: { id: { in: quoteIds } },
        include: { lineItem: { include: { product: true } } },
      }),
    ]);

    if (!order) {
      onLog(`QUOTE_RECEIVED: enquiry ${enquiryId} not found — skipping notification`);
      return;
    }

    if (!quotes.length) {
      onLog(`QUOTE_RECEIVED: no SupplierQuote rows found for ids=${quoteIds.join(",")} — skipping notification`);
      return;
    }

    const phone = order.user.whatsappNumber?.trim() || order.user.phone?.trim() || null;
    const enquiryDisplayId = order.enquiryId ?? order.id;
    const material = summarizeQuoteMaterials(quotes);
    const quantity = summarizeQuoteQuantities(quotes);

    const lineItemIds = Array.from(new Set(quotes.map((q: any) => q.lineItemId))).sort();
    const dedupeKey = `QUOTE_RECEIVED:${enquiryId}:${supplierId}:${lineItemIds.join(",")}`;

    // 1. In-App Notification (Bell icon in Buyer portal)
    const inAppDedupeKey = `builder-quote-received:${enquiryId}:${supplierId}:${lineItemIds.join(",")}`;
    const existingInApp = await prisma.notification.findFirst({
      where: { idempotencyKey: inAppDedupeKey },
      select: { id: true },
    }).catch(() => null);

    if (!existingInApp) {
      await prisma.notification.create({
        data: {
          userId: order.userId,
          channel: "IN_APP",
          audience: "BUILDER",
          title: "Quote Received",
          body: `A supplier has submitted a quotation for your requirement ${enquiryDisplayId}. Material: ${material}. Quantity: ${quantity}. Please review the quotation on Buildohub.`,
          idempotencyKey: inAppDedupeKey,
          status: "sent",
          templateType: "RFQ_QUOTE_SHARED",
          variables: JSON.stringify({ orderId: enquiryId, enquiryDisplayId, material, quantity }),
          read: false,
        },
      }).catch((err: any) => {
        onLog(`QUOTE_RECEIVED in-app alert creation failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    // 2. WhatsApp Notification
    const decision = await evaluatePolicy(prisma, order.userId, dedupeKey);

    if (!decision.allowed) {
      await prisma.notificationEvent.create({
        data: {
          eventType: EVENT_TYPE,
          recipientId: order.userId,
          recipientType: "builder",
          entityType: "Order",
          entityId: enquiryId,
          channel: CHANNEL,
          payload: { enquiryId, supplierId, quoteIds, enquiryDisplayId, material, quantity },
          status: "suppressed",
          suppressReason: decision.reason,
        },
      }).catch(() => undefined);
      onLog(`QUOTE_RECEIVED suppressed for enquiry=${enquiryId} supplier=${supplierId}: reason=${decision.reason}`);
      return;
    }

    const event = await prisma.notificationEvent.create({
      data: {
        eventType: EVENT_TYPE,
        recipientId: order.userId,
        recipientType: "builder",
        entityType: "Order",
        entityId: enquiryId,
        channel: CHANNEL,
        dedupeKey,
        payload: { enquiryId, supplierId, quoteIds, enquiryDisplayId, material, quantity },
        status: "created",
      },
    });

    if (!phone) {
      await prisma.notificationEvent.update({ where: { id: event.id }, data: { status: "failed" } });
      onLog(`QUOTE_RECEIVED: no phone/whatsappNumber on file for enquiry=${enquiryId}, recipient=${order.userId} — skipping send`);
      return;
    }

    const parameters = [enquiryDisplayId, material, quantity];
    const buttonUrlSuffix = enquiryId; // Bare order ID for dynamic URL button prefix https://buildohub.in/orders/{{1}}

    const sendResult = await sendTemplateViaMeta(
      prisma,
      phone,
      decision.templateName,
      parameters,
      onLog,
      buttonUrlSuffix
    );

    await prisma.notificationEvent.update({
      where: { id: event.id },
      data: { status: sendResult.success ? "sent" : "failed" },
    });

    if (!sendResult.success) {
      onLog(`QUOTE_RECEIVED WhatsApp send failed for enquiry=${enquiryId} supplier=${supplierId}: ${sendResult.error ?? "unknown error"}`);
    }
  } catch (error) {
    onLog(`QUOTE_RECEIVED notification failed for enquiry=${enquiryId} supplier=${supplierId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

