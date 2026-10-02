// packages/db/lib/supplier-rfq-received-notification.ts
//
// Shared, framework-agnostic implementation of the `supplier_quote_alert`
// WhatsApp notification (Meta WhatsApp Cloud API, Notification Engine
// pipeline) — fired when a supplier is actually assigned an RFQ/enquiry line
// item and is expected to submit a quotation.
//
// WHY THIS LIVES HERE (packages/db) RATHER THAN apps/api:
// Mirrors the exact existing pattern already established for
// `customer_order_status` (see customer-order-status-notification.ts in this
// same folder): the real RFQ-dispatch-to-supplier call sites live in BOTH a
// NestJS deployable (apps/api) and two separate Next.js deployables
// (apps/web — cart/checkout + Quick Material Request + AI Sourcing
// Assistant confirm; apps/supplier — the candidate-promotion decline
// cascade), neither of which can inject apps/api's NestJS
// `NotificationEngineService`. Rather than inventing a second/competing
// WhatsApp architecture for those two apps, this module is the ONE place
// the full
//   NotificationEventPolicy -> NotificationEvent -> WhatsAppMessageLog -> Meta
// pipeline is implemented for this event, operating directly against the
// same Prisma tables the NestJS Notification Engine already uses — exactly
// like `notifyCustomerOrderStatusChanged` above. apps/api gets its own thin
// NestJS wrapper (see
// apps/api/src/notification-engine/whatsapp/supplier-rfq-received-notification.service.ts)
// that routes through `NotificationEngineService.dispatch()` instead, but
// both implementations enforce identical policy/dedupe/template semantics
// against the same NotificationEventPolicy row (eventType
// SUPPLIER_RFQ_RECEIVED, templateName "supplier_quote_alert", Meta Template
// ID 2046949149261282 — see packages/db/scripts/seed-notification-templates.js).
//
// RFQ source entity / trigger (repository audit): the real, in-production
// "RFQ dispatched to supplier" business event is an `OrderItem` being
// assigned an active `supplierId` — NOT `QuickRequest` creation (no
// builder-facing UI creates QuickRequest rows; see the doc comments on
// `RfqsService.findAll` / `getSupplierRfqs` in apps/supplier/lib/supplier-data.ts).
// An OrderItem's `supplierId` becomes "active" at two distinct points, both
// of which must fire this notification (each is a genuinely new, supplier-
// specific "you must now quote this" event):
//   1. Order/OrderItem creation (apps/web/lib/order-checkout.ts
//      createOrdersFromCart, and apps/api's BuilderOrdersService.create) —
//      the newly-created item's `supplierId` (rank-0 candidate) is assigned
//      for the first time.
//   2. Candidate-promotion after a decline (apps/supplier/lib/supplier-data.ts
//      declineOrderForSupplier, and apps/api's OrdersService.declineForSupplier)
//      — the next-ranked PENDING OrderItemSupplierCandidate is promoted to
//      become the item's new active `supplierId`.
// Both are represented identically here: the caller passes the `orderItemId`
// whose *current* `supplierId` has just become active — this function reads
// that supplierId fresh from the database, so it is always correct
// regardless of which of the two call sites triggered it.
//
// Template variable sources (spec §5 — no invented/reconstructed values):
//   {{1}} Material           = OrderItem.product.name (canonical product name)
//   {{2}} Quantity            = `${OrderItem.quantity} ${OrderItem.product.unit}`
//                               (identical format already used by
//                               RfqsService.findAll / getSupplierRfqs)
//   {{3}} Delivery location   = Order.deliveryAddress, falling back to the
//                               exact same fallback string already shown to
//                               suppliers for enquiry-sourced RFQ cards
//                               ("See order for delivery details" — see
//                               getSupplierRfqs in apps/supplier/lib/supplier-data.ts)
//   {{4}} Quote deadline      = Order.createdAt + QUOTE_DEADLINE_MINUTES
//                               minutes — the SAME env var and SAME
//                               "how long suppliers have to quote" concept
//                               already used by BestPriceSelectionService to
//                               decide when RFQ quote collection closes (see
//                               apps/api/src/supplier/rfqs/best-price-selection.service.ts).
//                               Falls back to the existing 24-hour RFQ
//                               response-window default already hardcoded in
//                               both getSupplierRfqs implementations
//                               (`createdAt + 24 * 60 * 60 * 1000`) when
//                               QUOTE_DEADLINE_MINUTES is unset/zero — never
//                               an invented new default.
//
// Deduplication (spec §9): dedupe key is
// `SUPPLIER_RFQ_RECEIVED:{orderItemId}:{supplierId}` — orderItemId+supplierId
// is already the exact canonical identifier for "this specific
// supplier/line-item assignment" (it is the real unique constraint on
// OrderItemSupplierCandidate: `@@unique([orderItemId, supplierId])`), so a
// retried/duplicate request against the SAME assignment is blocked by the
// existing NotificationEvent.dedupeKey unique constraint, while a genuinely
// NEW assignment (a different supplier promoted onto the same item after a
// decline) naturally gets a fresh dedupe key and a fresh notification.
//
// Never throws — every failure (DB error, Meta error, missing phone, policy
// suppression) is swallowed and logged via the optional `onLog` callback, so
// a WhatsApp failure can never roll back or block the RFQ/order mutation
// that triggered it. Callers MUST invoke this AFTER the OrderItem's
// `supplierId` mutation has already committed, never inside the same
// transaction.

const EVENT_TYPE = "SUPPLIER_RFQ_RECEIVED";
const CHANNEL = "WHATSAPP";

/** Existing 24-hour RFQ response-window default — see doc comment above. */
const DEFAULT_QUOTE_DEADLINE_MS = 24 * 60 * 60 * 1000;

const NO_DELIVERY_LOCATION_FALLBACK = "See order for delivery details";

export type NotifySupplierRfqReceivedParams = {
  /** The OrderItem whose current `supplierId` has just become the active, expected-to-quote supplier. */
  orderItemId: string;
};

/**
 * Minimal structural Prisma-client shape this module needs — mirrors the
 * identical `any`-returning-delegate pattern already used by
 * `NotificationEnginePrismaClient` in customer-order-status-notification.ts
 * (see that file's doc comment for why this is safe here).
 */
export type SupplierRfqReceivedPrismaClient = {
  orderItem: { findUnique: (args: any) => Promise<any> };
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
};

/** live | dry-run | off — mirrors WhatsAppEngineConfigService.getMode()'s contract exactly. */
export type SupplierRfqReceivedWhatsAppMode = "live" | "dry-run" | "off";

/**
 * Reads NOTIFICATION_ENGINE_WHATSAPP_MODE — the SAME env var name already
 * used by apps/api's WhatsAppEngineConfigService.getMode() and by
 * `getCustomerOrderStatusWhatsAppMode()` above. Never a second/renamed env
 * var.
 */
export function getSupplierRfqReceivedWhatsAppMode(): SupplierRfqReceivedWhatsAppMode {
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
  return process.env.WHATSAPP_TEMPLATE_LANGUAGE || process.env.WHATSAPP_TEMPLATE_LANGUAGE_CODE || "en_US";
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

/** Builds the canonical dedupe identity for a specific (orderItem, supplier) RFQ assignment — see doc comment above. */
export function buildSupplierRfqReceivedDedupeKey(orderItemId: string, supplierId: string): string {
  return `${EVENT_TYPE}:${orderItemId}:${supplierId}`;
}

/**
 * Resolves the quote deadline for an RFQ — reuses QUOTE_DEADLINE_MINUTES
 * (the same env var BestPriceSelectionService already uses to decide when
 * quote collection closes), falling back to the existing 24-hour RFQ
 * response-window default. Never invents a new default/calculation.
 */
export function resolveSupplierQuoteDeadline(orderCreatedAt: Date): Date {
  const parsed = Number(process.env.QUOTE_DEADLINE_MINUTES);
  const minutesMs = Number.isFinite(parsed) && parsed > 0 ? parsed * 60 * 1000 : DEFAULT_QUOTE_DEADLINE_MS;
  return new Date(orderCreatedAt.getTime() + minutesMs);
}

/** Matches the existing supplier-facing "dueBy" display format exactly (see RfqsService.findAll / getSupplierRfqs). */
export function formatSupplierQuoteDeadlineLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(value);
}

/**
 * Low-level Meta Cloud API template send — exactly 4 body parameters, no
 * header (the approved template's "Review RFQ" button is rendered
 * automatically by WhatsApp from the template definition itself — see
 * WhatsappNotificationService's doc comment for why no extra `components`
 * entry is needed). Mirrors apps/api's
 * WhatsappNotificationService.sendTemplateAlert / this package's
 * `customer-order-status-notification.ts` sendTemplateViaMeta byte-for-byte
 * (same payload shape, same WhatsAppMessageLog bookkeeping, same
 * live/dry-run/off branching) so every app produces identical audit-trail
 * rows and identical Meta payloads.
 */
async function sendTemplateViaMeta(
  prisma: SupplierRfqReceivedPrismaClient,
  phone: string,
  templateName: string,
  parameters: string[],
  log: (message: string) => void
): Promise<{ success: boolean; externalId?: string; error?: string }> {
  const mode = getSupplierRfqReceivedWhatsAppMode();

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

  // mode === "live"
  try {
    const phoneNumberId = getPhoneNumberId();
    const accessToken = getAccessToken();
    if (!phoneNumberId || !accessToken) {
      const errorDetails = "WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN not configured";
      await prisma.whatsAppMessageLog.update({ where: { id: logRow.id }, data: { status: "failed", errorDetails } });
      return { success: false, error: errorDetails };
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: getTemplateLanguage() },
        ...(parameters.length > 0
          ? { components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] }
          : {}),
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

/**
 * Evaluates the existing NotificationPolicyService rules (event
 * enabled/channel enabled -> global WhatsApp kill-switch -> user opt-out ->
 * dedupe-key uniqueness) — identical semantics to apps/api's
 * NotificationPolicyService.evaluate(), reimplemented here
 * (framework-agnostic) against the SAME Prisma tables, exactly mirroring
 * `evaluatePolicy` in customer-order-status-notification.ts.
 */
async function evaluatePolicy(
  prisma: SupplierRfqReceivedPrismaClient,
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

/**
 * Notifies a supplier that they have been assigned an RFQ/enquiry line item
 * and are expected to submit a quotation, via the `supplier_quote_alert`
 * Meta WhatsApp template, routed through the existing Notification Engine
 * tables (NotificationEventPolicy, NotificationEvent, NotificationGlobalSettings,
 * NotificationPreference, WhatsAppMessageLog).
 *
 * Never throws — every failure is caught and logged via `onLog`.
 */
export async function notifySupplierRfqReceived(
  prisma: SupplierRfqReceivedPrismaClient,
  params: NotifySupplierRfqReceivedParams,
  onLog: (message: string) => void = () => undefined
): Promise<void> {
  const { orderItemId } = params;

  try {
    const orderItem = await prisma.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        product: true,
        order: true,
        supplier: { include: { user: true } },
      },
    });

    if (!orderItem) {
      onLog(`SUPPLIER_RFQ_RECEIVED: orderItem ${orderItemId} not found — skipping notification`);
      return;
    }

    const supplierId: string = orderItem.supplierId;
    const supplierUser = orderItem.supplier?.user;
    if (!supplierUser) {
      onLog(`SUPPLIER_RFQ_RECEIVED: no supplier/user found for orderItem=${orderItemId} supplier=${supplierId} — skipping notification`);
      return;
    }

    const phone = supplierUser.whatsappNumber?.trim() || supplierUser.phone?.trim() || null;

    const material = orderItem.product?.name ?? "your requested material";
    const quantity = `${orderItem.quantity}${orderItem.product?.unit ? ` ${orderItem.product.unit}` : ""}`;
    const deliveryLocation = orderItem.order?.deliveryAddress?.trim() || NO_DELIVERY_LOCATION_FALLBACK;
    const quoteDeadline = formatSupplierQuoteDeadlineLabel(
      resolveSupplierQuoteDeadline(orderItem.order?.createdAt ?? new Date())
    );

    const dedupeKey = buildSupplierRfqReceivedDedupeKey(orderItemId, supplierId);

    const decision = await evaluatePolicy(prisma, supplierUser.id, dedupeKey);

    if (!decision.allowed) {
      await prisma.notificationEvent.create({
        data: {
          eventType: EVENT_TYPE,
          recipientId: supplierUser.id,
          recipientType: "supplier",
          entityType: "OrderItem",
          entityId: orderItemId,
          channel: CHANNEL,
          payload: { orderItemId, orderId: orderItem.orderId, supplierId, material, quantity, deliveryLocation, quoteDeadline },
          status: "suppressed",
          suppressReason: decision.reason,
        },
      });
      onLog(`SUPPLIER_RFQ_RECEIVED suppressed for orderItem=${orderItemId} supplier=${supplierId}: reason=${decision.reason}`);
      return;
    }

    const event = await prisma.notificationEvent.create({
      data: {
        eventType: EVENT_TYPE,
        recipientId: supplierUser.id,
        recipientType: "supplier",
        entityType: "OrderItem",
        entityId: orderItemId,
        channel: CHANNEL,
        dedupeKey,
        payload: { orderItemId, orderId: orderItem.orderId, supplierId, material, quantity, deliveryLocation, quoteDeadline },
        status: "created",
      },
    });

    if (!phone) {
      await prisma.notificationEvent.update({ where: { id: event.id }, data: { status: "failed" } });
      onLog(`SUPPLIER_RFQ_RECEIVED: no phone/whatsappNumber on file for orderItem=${orderItemId}, supplier=${supplierId} — skipping send`);
      return;
    }

    const sendResult = await sendTemplateViaMeta(
      prisma,
      phone,
      decision.templateName,
      [material, quantity, deliveryLocation, quoteDeadline],
      onLog
    );

    await prisma.notificationEvent.update({ where: { id: event.id }, data: { status: sendResult.success ? "sent" : "failed" } });

    if (!sendResult.success) {
      onLog(`SUPPLIER_RFQ_RECEIVED WhatsApp send failed for orderItem=${orderItemId} supplier=${supplierId}: ${sendResult.error ?? "unknown error"}`);
    }
  } catch (error) {
    onLog(`SUPPLIER_RFQ_RECEIVED notification failed for orderItem=${orderItemId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

