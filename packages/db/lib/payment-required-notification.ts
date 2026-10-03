// packages/db/lib/payment-required-notification.ts
//
// Shared, framework-agnostic implementation of the `payment_required` Meta
// WhatsApp template (Notification Engine pipeline) — fired the ONE time an
// Order becomes payable, i.e. the moment it transitions PLACED -> PROCESSING
// while its PaymentStatus is still PENDING (no payment made yet).
//
// AUDIT (per task spec §2-9) — repository evidence this implementation is
// based on, not invented:
//
// Payment source entity:      Order (packages/db/prisma/schema.prisma).
//                              There is no separate "payment obligation"
//                              row created ahead of time — PaymentVerification
//                              (the bank-transfer proof/admin-review record)
//                              is only ever created later, when/if the
//                              customer actually uploads a screenshot (see
//                              apps/web/app/api/builder/orders/[id]/payment-proof/route.ts).
//                              Until then, the only durable signal that
//                              "this customer must now pay" is
//                              Order.paymentStatus === PENDING together with
//                              Order.status === PROCESSING (exactly the
//                              existing `paymentLinkAvailable` condition
//                              already used on both the builder orders list
//                              and order-detail routes — see
//                              apps/web/app/api/builder/orders/route.ts /
//                              apps/web/app/api/builder/orders/[id]/route.ts).
// Payment obligation entity:  Order itself (no separate Payment/Invoice row
//                              exists at this point in the lifecycle —
//                              Invoice is generated much later, only after
//                              PaymentVerification.status === APPROVED).
// Actual trigger:              Order.status transitions PLACED -> PROCESSING
//                              while Order.paymentStatus is still PENDING.
//                              This is the supplier/best-price "confirm this
//                              enquiry" business event — the one and only
//                              place a payment first becomes actionable (the
//                              BankTransferPaymentPanel on the customer's
//                              payment page only renders once
//                              `paymentLinkAvailable` is true, which requires
//                              this exact status+paymentStatus combination).
// Triggering paths (repository audit — ALL real, in-production call sites
// that perform this specific PLACED -> PROCESSING transition without also
// marking payment PAID in the same mutation):
//   1. apps/api BestPriceSelectionService.selectAndFinalizeIfEligible
//      (multi-supplier RFQ auto-confirmation).
//   2. apps/api supplier/orders/orders.service.ts OrdersService.updateStatus
//      (supplier "Confirm Enquiry" action via the NestJS backend).
//   3. apps/supplier/lib/supplier-data.ts updateSupplierOrderStatus (the
//      Next.js supplier-portal's own "Confirm Enquiry" action).
// Deliberately EXCLUDED: apps/api/src/admin/payments/payments.service.ts
// PaymentsService.approve also moves PLACED -> PROCESSING, but ALWAYS in the
// same mutation that sets `paymentStatus: PAID` — i.e. payment has already
// been verified/completed by the time that transition happens, so there is
// nothing left to pay. This module's own `paymentStatus === PENDING` guard
// (re-read fresh from the DB, never trusted from the caller) makes calling
// this function from that call site a safe no-op regardless, but it is not
// wired there since it would never actually fire.
//
// Recipient: the Order's own `userId`/`user` (the builder/customer who
// placed the enquiry) — identical identity-resolution helper already used by
// `notifyCustomerOrderStatusChanged` (order.user.whatsappNumber || .phone),
// never a new/duplicated phone lookup.
//
// Approved Meta template contract (fetched directly from the Graph API
// message_templates endpoint using this repo's own configured
// WHATSAPP_BUSINESS_ACCOUNT_ID / WHATSAPP_ACCESS_TOKEN — not invented):
//   Template name:   payment_required
//   Meta Template ID: 1457666726425273
//   Language:        en
//   Category:        UTILITY
//   Body: "Payment is required for your Buildohub requirement {{1}}.
//
//          Amount payable: {{2}}
//          Payment deadline: {{3}}
//
//          Please complete the payment to proceed with your order."
//   Buttons: one static QUICK_REPLY button ("Make Payment") — NOT a dynamic
//          URL button, so (exactly like `supplier_po_alert`'s "View Purchase
//          Order" button) WhatsApp renders it automatically from the
//          template definition; no extra `components` entry/URL parameter is
//          sent for it.
//   {{1}} = enquiry/order display ID  = Order.enquiryId ?? Order.id (the
//          exact same canonical display-ID fallback used by
//          `customer_order_status` / `supplier_po_alert`).
//   {{2}} = amount payable            = Order.totalAmount (the canonical,
//          single order total already shown to the customer on the
//          payment page — apps/web/app/(builder)/orders/[id]/payment/page.tsx
//          — and the exact same amount PaymentVerification.amount is set to
//          when a proof is later submitted, see payment-proof/route.ts:
//          `amount: order.totalAmount`). Never independently
//          recalculated/derived — this schema has no partial-payment,
//          already-paid, or outstanding-balance concept at this point in the
//          lifecycle (PaymentStatus is a simple
//          PENDING -> PENDING_VERIFICATION -> PAID state machine with no
//          amount tracking of its own), so `totalAmount` IS the canonical
//          "amount currently payable" figure. Formatted with the exact same
//          `₹${n.toLocaleString("en-IN")}` convention already used by
//          apps/web/lib/builder-db.ts's formatCurrency (what the customer
//          sees on the payment page), so the WhatsApp message always matches
//          the UI.
//   {{3}} = payment deadline          = There is no due-date column on Order
//          anywhere in the schema (confirmed — no `dueAt`/`deadline`/
//          `paymentDeadline` field exists on Order, Invoice, or
//          PaymentVerification). Rather than inventing a stored field or a
//          second payment-calculation service, this mirrors the existing,
//          explicitly-sanctioned pattern of introducing a clean,
//          environment-driven configuration value when no such table/column
//          exists yet (see apps/web/lib/bank-account-config.ts's own doc
//          comment for the identical justification) — PAYMENT_DUE_DAYS
//          (default 2 days), computed as `now + N days` at the moment this
//          transition is processed and formatted with the exact same
//          `toLocaleDateString("en-IN")` convention already used by
//          apps/web/lib/builder-db.ts's formatDate.
//
// Deduplication: dedupe key is `PAYMENT_REQUIRED:{orderId}` — the
// PLACED -> PROCESSING transition is a one-directional, one-time event per
// Order (every call site above guards against re-confirming an
// already-PROCESSING/non-PLACED order — see e.g.
// VALID_SUPPLIER_TRANSITIONS / isValidOrderStatusTransition), so a single
// order can only ever genuinely need this notification once; a retried
// request, duplicate webhook delivery, or repeated order access is always
// blocked by the existing NotificationEvent.dedupeKey unique constraint,
// while a different (new) order always gets its own independent key.
//
// Never throws — every failure (DB error, Meta error, missing phone, policy
// suppression) is swallowed and logged via the optional `onLog` callback, so
// a WhatsApp failure can never roll back or block the order-status mutation
// that triggered it. Callers MUST invoke this AFTER the order-status
// mutation has already committed, never inside the same transaction —
// mirrors `notifyCustomerOrderStatusChanged`'s exact contract.

import { OrderStatus, PaymentStatus } from "@prisma/client";

const EVENT_TYPE = "PAYMENT_REQUIRED";
const CHANNEL = "WHATSAPP";

export type NotifyPaymentRequiredParams = {
  orderId: string;
  previousStatus: OrderStatus | null;
  newStatus: OrderStatus;
};

/**
 * Minimal structural Prisma-client shape this module needs — mirrors the
 * identical `any`-returning-delegate pattern already used by
 * `NotificationEnginePrismaClient` in customer-order-status-notification.ts
 * (see that file's doc comment for why this is safe here).
 */
export type PaymentRequiredPrismaClient = {
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
};

/** live | dry-run | off — mirrors WhatsAppEngineConfigService.getMode()'s contract exactly. */
export type PaymentRequiredWhatsAppMode = "live" | "dry-run" | "off";

/**
 * Reads NOTIFICATION_ENGINE_WHATSAPP_MODE — the SAME env var name already
 * used by apps/api's WhatsAppEngineConfigService.getMode() and every other
 * *-notification.ts module in this package. Never a second/renamed env var.
 */
export function getPaymentRequiredWhatsAppMode(): PaymentRequiredWhatsAppMode {
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

/**
 * Days before the payment deadline shown in {{3}} — see this file's top doc
 * comment for why this is an env-driven value rather than a stored column.
 * Defaults to 2 days.
 */
function getPaymentDueDays(): number {
  const raw = process.env.PAYMENT_DUE_DAYS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 2;
}

/** Mirrors apps/web/lib/builder-db.ts's formatCurrency exactly, so the WhatsApp message always matches the payment page's own figure. */
export function formatPaymentAmount(amount: { toNumber?: () => number } | number | string): string {
  const n = Number(amount);
  return `₹${n.toLocaleString("en-IN")}`;
}

/** Mirrors apps/web/lib/builder-db.ts's formatDate exactly, computed as `now + PAYMENT_DUE_DAYS days`. */
export function formatPaymentDeadline(from: Date = new Date()): string {
  const deadline = new Date(from);
  deadline.setDate(deadline.getDate() + getPaymentDueDays());
  return deadline.toLocaleDateString("en-IN");
}

/** Builds the canonical dedupe identity for a specific order's one-time payment-required notification — see doc comment above. */
export function buildPaymentRequiredDedupeKey(orderId: string): string {
  return `${EVENT_TYPE}:${orderId}`;
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
 * Low-level Meta Cloud API template send — exactly 3 body parameters, no
 * header. The approved template's static "Make Payment" QUICK_REPLY button
 * is rendered automatically by WhatsApp from the template definition itself
 * (not a dynamic URL button, so no extra `components` entry is needed — see
 * WhatsappNotificationService's doc comment / supplier_po_alert's identical
 * static-button handling). Mirrors apps/api's
 * WhatsappNotificationService.sendTemplateAlert / this package's other
 * *-notification.ts `sendTemplateViaMeta` byte-for-byte (same payload shape,
 * same WhatsAppMessageLog bookkeeping, same live/dry-run/off branching) so
 * every app produces identical audit-trail rows and identical Meta payloads.
 */
async function sendTemplateViaMeta(
  prisma: PaymentRequiredPrismaClient,
  phone: string,
  templateName: string,
  parameters: string[],
  log: (message: string) => void
): Promise<{ success: boolean; externalId?: string; error?: string }> {
  const mode = getPaymentRequiredWhatsAppMode();

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
 * registry row. Mirrors `evaluatePolicy` in customer-order-status-notification.ts.
 */
async function evaluatePolicy(
  prisma: PaymentRequiredPrismaClient,
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
 * Notifies the customer/builder that payment is now required for their
 * Order, via the `payment_required` Meta WhatsApp template, routed through
 * the existing Notification Engine tables (NotificationEventPolicy,
 * NotificationEvent, NotificationGlobalSettings, NotificationPreference,
 * WhatsAppMessageLog).
 *
 * Only ever fires on a genuine PLACED -> PROCESSING transition (mirrors
 * `notifyCustomerOrderStatusChanged`'s exact transition guard) AND only when
 * the order's `paymentStatus` is still PENDING at the moment this runs (read
 * fresh from the DB, never trusted from the caller) — see this file's top
 * doc comment for why this is the correct, narrow trigger condition.
 *
 * Never throws — every failure is caught and logged via `onLog`.
 */
export async function notifyPaymentRequired(
  prisma: PaymentRequiredPrismaClient,
  params: NotifyPaymentRequiredParams,
  onLog: (message: string) => void = () => undefined
): Promise<void> {
  const { orderId, previousStatus, newStatus } = params;

  if (previousStatus !== OrderStatus.PLACED || newStatus !== OrderStatus.PROCESSING) {
    // Not the one business event this notification represents — see doc
    // comment above (only the first PLACED -> PROCESSING confirmation ever
    // makes payment "required").
    return;
  }

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });
    if (!order) {
      onLog(`PAYMENT_REQUIRED: order ${orderId} not found — skipping notification`);
      return;
    }

    if (order.paymentStatus !== PaymentStatus.PENDING) {
      // Already paid (e.g. the admin payment-approval path, which moves
      // PLACED -> PROCESSING in the SAME mutation that sets paymentStatus:
      // PAID) or otherwise not in the single PENDING state this event
      // represents — nothing to notify about.
      onLog(
        `PAYMENT_REQUIRED: order ${orderId} paymentStatus is ${order.paymentStatus} (not PENDING) — skipping notification`
      );
      return;
    }

    const phone = order.user.whatsappNumber?.trim() || order.user.phone?.trim() || null;
    const enquiryDisplayId = order.enquiryId ?? order.id;
    const amountPayable = formatPaymentAmount(order.totalAmount);
    const paymentDeadline = formatPaymentDeadline();

    const dedupeKey = buildPaymentRequiredDedupeKey(orderId);

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
          payload: { orderId, enquiryDisplayId, amountPayable, paymentDeadline },
          status: "suppressed",
          suppressReason: decision.reason,
        },
      });
      onLog(`PAYMENT_REQUIRED suppressed for order=${orderId}: reason=${decision.reason}`);
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
        payload: { orderId, enquiryDisplayId, amountPayable, paymentDeadline },
        status: "created",
      },
    });

    if (!phone) {
      await prisma.notificationEvent.update({ where: { id: event.id }, data: { status: "failed" } });
      onLog(`PAYMENT_REQUIRED: no phone/whatsappNumber on file for order=${orderId}, recipient=${order.userId} — skipping send`);
      return;
    }

    const sendResult = await sendTemplateViaMeta(
      prisma,
      phone,
      decision.templateName,
      [enquiryDisplayId, amountPayable, paymentDeadline],
      onLog
    );

    await prisma.notificationEvent.update({ where: { id: event.id }, data: { status: sendResult.success ? "sent" : "failed" } });

    if (!sendResult.success) {
      onLog(`PAYMENT_REQUIRED WhatsApp send failed for order=${orderId}: ${sendResult.error ?? "unknown error"}`);
    }
  } catch (error) {
    onLog(`PAYMENT_REQUIRED notification failed for order=${orderId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
