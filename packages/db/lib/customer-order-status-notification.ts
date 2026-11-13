// packages/db/lib/customer-order-status-notification.ts
//
// Shared, framework-agnostic implementation of the `customer_order_status`
// WhatsApp notification (Meta WhatsApp Cloud API, Notification Engine
// pipeline) — the SINGLE authoritative place a customer-facing WhatsApp
// message is sent when an Order's status transitions.
//
// WHY THIS LIVES HERE (packages/db) RATHER THAN apps/api:
// The real, production order-status-change path for suppliers
// (apps/supplier/lib/supplier-data.ts -> updateSupplierOrderStatus, invoked
// via the supplier portal's PATCH /api/supplier/orders/:id route) is a
// separate Next.js deployable with its own direct Prisma access — it does
// NOT call into the NestJS apps/api backend at all. apps/api's own
// CustomerOrderStatusNotificationService (src/notification-engine/whatsapp/)
// is NestJS-only and not importable from apps/supplier.
//
// Rather than inventing a second/competing WhatsApp architecture for
// apps/supplier, this module is the ONE place the full
//   NotificationEventPolicy -> NotificationEvent -> WhatsAppMessageLog -> Meta
// pipeline is implemented, operating directly against the same Prisma
// tables the NestJS Notification Engine already uses. Both apps/api (via a
// thin NestJS wrapper — see
// apps/api/src/notification-engine/whatsapp/customer-order-status-notification.service.ts)
// and apps/supplier (directly) call the exact same
// `notifyCustomerOrderStatusChanged()` function below, so there is exactly
// one send path, one dedupe mechanism, one policy evaluation, and one Meta
// transport — never two parallel implementations that could double-send.
//
// Mirrors the exact existing pattern already established for cross-app
// shared business logic (see business-number.ts / enquiry-id.ts): plain
// Prisma-shaped TxClient types, no framework (NestJS/Next.js) imports.
//
// Event type: ORDER_STATUS_CHANGED (channel: WHATSAPP), per the existing
// NotificationEventPolicy registry row (templateName "customer_order_status",
// metaTemplateId "1788249542353441" — see
// packages/db/scripts/seed-notification-templates.js, the single
// authoritative place the Meta template ID is configured).
//
// Template contract (Meta-approved, UTILITY category, "Order Status" type):
//   Body: "Your Buildohub order {{1}} has been updated. The current status
//   is {{2}}. Please check your Buildohub account for the latest delivery
//   information."
//   {{1}} = enquiry/order display ID, {{2}} = customer-facing status label.
//   No header, no buttons — exactly 2 body parameters, every call.
//
// Only ever notifies on a REAL transition (previousStatus !== newStatus) and
// never for initial creation (previousStatus === null).
//
// Never throws — every failure (DB error, Meta error, missing phone, policy
// suppression) is swallowed and logged via the optional `onLog` callback, so
// a WhatsApp failure can never roll back or block the order-status mutation
// that triggered it. Callers MUST invoke this AFTER the order status
// mutation has already committed, never inside the same transaction.

import { OrderStatus, NotificationChannel, NotificationTemplateType } from "@prisma/client";
import { getOrderStatusDisplayLabel } from "./order-status-labels";

const EVENT_TYPE = "ORDER_STATUS_CHANGED";
const CHANNEL = "WHATSAPP";

// ───────────────────────────────────────────────────────────
// In-app Alerts bell (apps/web/components/builder/NotificationBell.tsx,
// backed by apps/web/app/api/builder/notifications/route.ts) reads directly
// from the `Notification` table — a SEPARATE table/UI surface from the
// WhatsApp-only NotificationEvent/WhatsAppMessageLog pipeline this file was
// built around. Before the Meta WhatsApp Cloud API migration (see this
// file's top doc comment), the old `apps/supplier/lib/notify.ts`
// `notifyBuilderOrderStatusUpdate()` (now deleted) wrote a row into
// `Notification` for every order-status transition, which is what powered
// the Alerts bell. That write was accidentally dropped when this module
// replaced it — the WhatsApp send kept working, but builders stopped
// seeing any new in-app alerts for order-status changes from that point on.
//
// `writeInAppOrderStatusAlert` restores that write (best-effort, wrapped in
// its own try/catch so it can never block or affect the WhatsApp send
// below) WITHOUT reintroducing a second/competing WhatsApp implementation —
// this only ever inserts a row into the pre-existing `Notification` table,
// it never sends any message itself.
const IN_APP_STATUS_COPY: Partial<
  Record<OrderStatus, { title: string; body: (supplierLabel: string, deepLink: string) => string; templateType: NotificationTemplateType }>
> = {
  [OrderStatus.PROCESSING]: {
    title: "Enquiry confirmed",
    body: (supplierLabel, deepLink) => `Good news! ${supplierLabel} has confirmed your enquiry and is preparing your order. View details: ${deepLink}`,
    templateType: NotificationTemplateType.ORDER_ACCEPTED,
  },
  [OrderStatus.DISPATCHED]: {
    title: "Order dispatched",
    body: (supplierLabel, deepLink) => `${supplierLabel} has dispatched your order. It's on its way. View details: ${deepLink}`,
    templateType: NotificationTemplateType.ORDER_DISPATCHED,
  },
  [OrderStatus.OUT_FOR_DELIVERY]: {
    title: "Out for delivery",
    body: (supplierLabel, deepLink) => `Your order from ${supplierLabel} is out for delivery. View details: ${deepLink}`,
    templateType: NotificationTemplateType.ORDER_OUT_FOR_DELIVERY,
  },
  [OrderStatus.DELIVERED]: {
    title: "Order delivered",
    body: (supplierLabel, deepLink) => `Your order from ${supplierLabel} has been delivered. Thank you for using Buildohub. View details: ${deepLink}`,
    templateType: NotificationTemplateType.ORDER_DELIVERED,
  },
  [OrderStatus.CANCELLED]: {
    title: "Order cancelled",
    body: (supplierLabel, deepLink) => `${supplierLabel} has cancelled your order. Please contact support if you have questions. View details: ${deepLink}`,
    templateType: NotificationTemplateType.ORDER_DECLINED,
  },
};

function getBuilderPortalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BUILDER_APP_URL ||
    process.env.BUILDER_PORTAL_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://matsrc-web.vercel.app"
  );
}

/**
 * Minimal structural Prisma-client shape needed to write the in-app Alerts
 * bell row — exported so apps/api's own NestJS
 * `CustomerOrderStatusNotificationService` (src/notification-engine/
 * whatsapp/customer-order-status-notification.service.ts), which dispatches
 * its WhatsApp send through the NestJS `NotificationEngineService` instead
 * of calling `notifyCustomerOrderStatusChanged` below, can call this SAME
 * helper rather than re-implementing the copy/idempotency logic a second
 * time. Both implementations end up writing identical `Notification` rows.
 */
export type InAppAlertPrismaClient = {
  notification: {
    findFirst: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
};

export async function writeInAppOrderStatusAlert(
  prisma: InAppAlertPrismaClient,
  order: { id: string; userId: string; enquiryId?: string | null; items?: Array<{ supplier?: { companyName?: string | null } | null }> },
  newStatus: OrderStatus,
  onLog: (message: string) => void = () => undefined
): Promise<void> {
  try {
    const copy = IN_APP_STATUS_COPY[newStatus];
    if (!copy) {
      // PLACED (and any future status with no builder-facing copy) never
      // shows an in-app alert — matches the pre-migration behaviour.
      return;
    }

    // Idempotency per (order, status) — mirrors the pre-migration
    // `builder-order-status:{orderId}:{status}` key exactly, so this is
    // compatible with (and deduped against) any historical rows already
    // written under that scheme.
    const idempotencyKey = `builder-order-status:${order.id}:${newStatus}`;
    const existing = await prisma.notification.findFirst({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    const enquiryDisplayId = order.enquiryId ?? order.id;
    const supplierLabel = order.items?.[0]?.supplier?.companyName ?? "your supplier";
    const deepLink = `${getBuilderPortalBaseUrl().replace(/\/$/, "")}/orders/${order.id}`;

    await prisma.notification.create({
      data: {
        userId: order.userId,
        audience: "builder",
        channel: NotificationChannel.WHATSAPP,
        title: copy.title,
        body: copy.body(supplierLabel, deepLink),
        status: "sent",
        idempotencyKey,
        templateType: copy.templateType,
        variables: JSON.stringify({
          orderId: order.id,
          orderNumber: enquiryDisplayId,
          deepLink,
          supplierName: supplierLabel,
          status: newStatus,
        }),
        retryCount: 0,
      },
    });
  } catch (error) {
    onLog(`ORDER_STATUS_CHANGED in-app alert write failed for order=${order.id} (-> ${newStatus}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

export type NotifyCustomerOrderStatusChangedParams = {
  orderId: string;
  previousStatus: OrderStatus | null;
  newStatus: OrderStatus;
  /**
   * Optional idempotency salt for retries of the exact same logical
   * operation (e.g. a webhook delivery id) — defaults to the order+status
   * pair, which is already stable across simple retries since the dedupe
   * key never includes a timestamp.
   */
  transitionIdentity?: string;
};

/**
 * Minimal structural Prisma-client shape this module needs — matches
 * @prisma/client's generated delegate signatures closely enough to be used
 * directly with the real PrismaClient from either apps/api's PrismaService
 * or apps/supplier's/apps/web's `prisma` singleton (packages/db/index.ts),
 * without depending on either app's own DI/service layer.
 */
// Deliberately typed with `any`-returning method signatures (rather than a
// precisely-shaped structural type) — the real generated PrismaClient's
// delegate methods use complex conditional/overloaded generics (varying
// per `select`/`include` shape) that do not structurally satisfy a fixed
// narrow return type, even when the actual runtime shape matches exactly.
// This mirrors the same `tx: any` pattern already used throughout this
// package for the identical reason (see business-number.ts / enquiry-id.ts
// TxClient types) — safe here because every field this module reads
// (order.user.whatsappNumber/phone, policy.templateName, etc.) is read via
// optional chaining / nullish coalescing, never assumed present.
export type NotificationEnginePrismaClient = {
  order: { findUnique: (args: any) => Promise<any> };
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
  // Backs the in-app Alerts bell (apps/web/components/builder/
  // NotificationBell.tsx) — see writeInAppOrderStatusAlert's doc comment
  // above for why this additive write exists alongside the WhatsApp send.
  notification: {
    findFirst: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
};

/** live | dry-run | off — mirrors WhatsAppEngineConfigService.getMode()'s contract exactly. */
export type CustomerOrderStatusWhatsAppMode = "live" | "dry-run" | "off";

/**
 * Reads NOTIFICATION_ENGINE_WHATSAPP_MODE — the SAME env var name already
 * used by apps/api's WhatsAppEngineConfigService.getMode(). Never a
 * second/renamed env var; both apps/api and apps/supplier read this exact
 * name (each app's own Vercel project still needs the var set).
 */
export function getCustomerOrderStatusWhatsAppMode(): CustomerOrderStatusWhatsAppMode {
  const raw = (process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE || "dry-run").toLowerCase();
  if (raw === "live" || raw === "off") return raw;
  return "dry-run";
}

/** Same env var names as WhatsAppEngineConfigService — never duplicated/renamed. */
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

/**
 * Low-level Meta Cloud API template send — exactly 2 body parameters, no
 * header, no buttons (per the approved "customer_order_status" template
 * contract). Mirrors apps/api's
 * WhatsappNotificationService.sendTemplateAlert byte-for-byte (same payload
 * shape, same WhatsAppMessageLog bookkeeping, same live/dry-run/off
 * branching) so both apps produce identical audit-trail rows and identical
 * Meta payloads.
 */
async function sendTemplateViaMeta(
  prisma: NotificationEnginePrismaClient,
  phone: string,
  templateName: string,
  parameters: string[],
  log: (message: string) => void
): Promise<{ success: boolean; externalId?: string; error?: string }> {
  const mode = getCustomerOrderStatusWhatsAppMode();

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
 * (framework-agnostic) against the SAME Prisma tables so both apps enforce
 * identical policy decisions from the single NotificationEventPolicy
 * registry row. (Daily-limit/cooldown/business-hours checks are
 * intentionally out of scope here — the existing `customer_order_status`
 * policy row has none of those configured; apps/api's richer
 * NotificationPolicyService remains the reference implementation for any
 * event type that does use them.)
 */
async function evaluatePolicy(
  prisma: NotificationEnginePrismaClient,
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
 * Notifies the customer that their enquiry/order's status changed, via the
 * `customer_order_status` Meta WhatsApp template, routed through the
 * existing Notification Engine tables (NotificationEventPolicy,
 * NotificationEvent, NotificationGlobalSettings, NotificationPreference,
 * WhatsAppMessageLog).
 *
 * Only ever fires when `previousStatus !== newStatus`. Initial order
 * creation MUST be represented by the caller passing `previousStatus: null`,
 * which this function also treats as "no notification".
 *
 * Never throws — every failure is caught and logged via `onLog`.
 */
export async function notifyCustomerOrderStatusChanged(
  prisma: NotificationEnginePrismaClient,
  params: NotifyCustomerOrderStatusChangedParams,
  onLog: (message: string) => void = () => undefined
): Promise<void> {
  const { orderId, previousStatus, newStatus, transitionIdentity } = params;

  if (previousStatus === null || previousStatus === newStatus) {
    return;
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true, items: { include: { supplier: true } } },
    });
    if (!order) {
      onLog(`ORDER_STATUS_CHANGED: order ${orderId} not found — skipping notification`);
      return;
    }

    // In-app Alerts bell write (Notification table) — independent of, and
    // always attempted regardless of, the WhatsApp policy/send outcome
    // below. See writeInAppOrderStatusAlert's doc comment for why this
    // lives here.
    await writeInAppOrderStatusAlert(prisma, order, newStatus, onLog);

    const phone = order.user.whatsappNumber?.trim() || order.user.phone?.trim() || null;
    const enquiryDisplayId = order.enquiryId ?? order.id;
    const displayStatus = getOrderStatusDisplayLabel(newStatus);

    const dedupeKey = transitionIdentity
      ? `${EVENT_TYPE}:${orderId}:${previousStatus}:${newStatus}:${transitionIdentity}`
      : `${EVENT_TYPE}:${orderId}:${previousStatus}:${newStatus}`;

    const decision = await evaluatePolicy(prisma, order.userId, dedupeKey);

    if (!decision.allowed) {
      await prisma.notificationEvent.create({
        data: {
          eventType: EVENT_TYPE,
          recipientId: order.userId,
          recipientType: "builder",
          entityType: "Order",
          entityId: orderId,
          channel: CHANNEL,
          payload: { orderId, previousStatus, newStatus, displayStatus },
          status: "suppressed",
          suppressReason: decision.reason,
        },
      });
      onLog(`ORDER_STATUS_CHANGED suppressed for order=${orderId} (${previousStatus} -> ${newStatus}): reason=${decision.reason}`);
      return;
    }

    const event = await prisma.notificationEvent.create({
      data: {
        eventType: EVENT_TYPE,
        recipientId: order.userId,
        recipientType: "builder",
        entityType: "Order",
        entityId: orderId,
        channel: CHANNEL,
        dedupeKey,
        payload: { orderId, previousStatus, newStatus, displayStatus },
        status: "created",
      },
    });

    if (!phone) {
      await prisma.notificationEvent.update({ where: { id: event.id }, data: { status: "failed" } });
      onLog(`ORDER_STATUS_CHANGED: no phone/whatsappNumber on file for order=${orderId}, recipient=${order.userId} — skipping send`);
      return;
    }

    const sendResult = await sendTemplateViaMeta(prisma, phone, decision.templateName, [enquiryDisplayId, displayStatus], onLog);

    await prisma.notificationEvent.update({ where: { id: event.id }, data: { status: sendResult.success ? "sent" : "failed" } });

    if (!sendResult.success) {
      onLog(`ORDER_STATUS_CHANGED WhatsApp send failed for order=${orderId} (${previousStatus} -> ${newStatus}): ${sendResult.error ?? "unknown error"}`);
    }
  } catch (error) {
    onLog(`ORDER_STATUS_CHANGED notification failed for order=${orderId} (${previousStatus} -> ${newStatus}): ${error instanceof Error ? error.message : String(error)}`);
  }
}
