// packages/db/lib/supplier-po-received-notification.ts
//
// Shared, framework-agnostic implementation of the `supplier_po_alert`
// WhatsApp notification (Meta WhatsApp Cloud API, Notification Engine
// pipeline) — fired when a supplier is actually issued a Purchase Order and
// is expected to review/act on it.
//
// WHY THIS LIVES HERE (packages/db) RATHER THAN apps/api:
// Mirrors the exact existing pattern already established for
// `supplier_quote_alert` (see supplier-rfq-received-notification.ts in this
// same folder): the real PO-issuance call sites live in BOTH a NestJS
// deployable (apps/api — PurchaseOrdersService.approve) and a separate
// Next.js deployable (apps/web — /api/builder/purchase-orders/[id]/approve
// route), neither of which can inject apps/api's NestJS
// `NotificationEngineService` from the other. Rather than inventing a
// second/competing WhatsApp architecture for apps/web, this module is the
// ONE place the full
//   NotificationEventPolicy -> NotificationEvent -> WhatsAppMessageLog -> Meta
// pipeline is implemented for this event, operating directly against the
// same Prisma tables the NestJS Notification Engine already uses — exactly
// like `notifySupplierRfqReceived` above. apps/api gets its own thin NestJS
// wrapper (see
// apps/api/src/notification-engine/whatsapp/supplier-po-received-notification.service.ts)
// that routes through `NotificationEngineService.dispatch()` instead, but
// both implementations enforce identical policy/dedupe/template semantics
// against the same NotificationEventPolicy row (eventType
// SUPPLIER_PO_RECEIVED, templateName "supplier_po_alert", Meta Template ID
// 1999605497419495, language "en" — see
// packages/db/scripts/seed-notification-templates.js).
//
// PO issuance trigger (repository audit): the real, in-production "PO has
// been issued to the supplier and they are now expected to act on it"
// business event is `PurchaseOrder.status` transitioning DRAFT -> ISSUED —
// NOT `PurchaseOrder` row creation. `PurchaseOrdersService.create()` always
// creates the PO in DRAFT status (see `PurchaseOrderStatus.DRAFT` default in
// schema.prisma), which is builder-editable and not yet the supplier's to
// act on. The transition to ISSUED happens exactly in
// `PurchaseOrdersService.approve()` (apps/api) and the mirrored
// `/api/builder/purchase-orders/[id]/approve/route.ts` (apps/web) — both are
// OTP-gated, e-signature-equivalent builder actions that are the one and
// only place `PurchaseOrderStatus.ISSUED` is ever set in this repository.
// This function is called from both of those call sites, immediately after
// the `status: ISSUED` update commits.
//
// Template variable sources (spec §5 — no invented/reconstructed values),
// confirmed against the live, Meta-approved `supplier_po_alert` template
// (ID 1999605497419495, category UTILITY, language "en"):
//   Body: "A purchase order {{1}} has been issued to you by Buildohub.
//          Material: {{2}}
//          Quantity: {{3}}
//          Please review the purchase order on Buildohub."
//   Buttons: one static QUICK_REPLY button ("View Purchase Order") — NOT a
//          dynamic URL button, so no extra `components` entry/URL parameter
//          is required when sending (WhatsApp renders the static button
//          itself, same as `supplier_quote_alert`'s "Review RFQ" button —
//          see WhatsappNotificationService's doc comment for why body-only
//          `components` is correct here).
//   {{1}} PO/order ID = PurchaseOrder.poNumber (the canonical, supplier-
//          facing PO identifier — the exact string shown as the page title
//          on the supplier portal PO detail page, see
//          apps/supplier/app/(supplier)/purchase-orders/[id]/page.tsx).
//   {{2}} Material      = PurchaseOrderLineItem.product.name for a
//          single-line-item PO; for a multi-line-item PO, a comma-joined
//          summary of up to 3 product names (+N more), mirroring the exact
//          truncation convention already used by
//          WhatsAppLifecycleService.lineItemSummary /
//          NotificationService.buildOrderLineItemSummary elsewhere in this
//          codebase — never a reconstructed/derived material name.
//   {{3}} Quantity      = `${quantity} ${unit}` for a single-line-item PO
//          (identical format already used by
//          supplier-rfq-received-notification.ts), or the matching
//          comma-joined per-item quantity summary for a multi-line-item PO
//          (same ordering/truncation as the material summary above, so
//          {{2}} and {{3}} always line up item-for-item).
//
// Deduplication (spec §11): dedupe key is
// `SUPPLIER_PO_RECEIVED:{purchaseOrderId}:{supplierId}` — PurchaseOrder.id
// is already the canonical identifier for one specific, immutable
// builder-to-supplier PO issuance (there is no PO-reassignment/reissue code
// path in this repository — `PurchaseOrder.supplierId` is set once at
// creation and `status` only ever moves forward DRAFT -> ISSUED ->
// ACKNOWLEDGED -> FULFILLED), so a retried/duplicate approval request
// against the SAME PO is blocked by the existing
// NotificationEvent.dedupeKey unique constraint. supplierId is included
// defensively (consistent with the RFQ event's convention) in case a future
// reassignment/reissue path is introduced.
//
// Never throws — every failure (DB error, Meta error, missing phone, policy
// suppression) is swallowed and logged via the optional `onLog` callback, so
// a WhatsApp failure can never roll back or block the PO-approval mutation
// that triggered it. Callers MUST invoke this AFTER the PurchaseOrder's
// `status: ISSUED` mutation has already committed, never inside the same
// transaction.

const EVENT_TYPE = "SUPPLIER_PO_RECEIVED";
const CHANNEL = "WHATSAPP";

const MAX_SUMMARY_ITEMS = 3;

export type NotifySupplierPoReceivedParams = {
  /** The PurchaseOrder that has just transitioned to ISSUED. */
  purchaseOrderId: string;
};

/**
 * Minimal structural Prisma-client shape this module needs — mirrors the
 * identical `any`-returning-delegate pattern already used by
 * `SupplierRfqReceivedPrismaClient` in supplier-rfq-received-notification.ts
 * (see that file's doc comment for why this is safe here).
 */
export type SupplierPoReceivedPrismaClient = {
  purchaseOrder: { findUnique: (args: any) => Promise<any> };
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
export type SupplierPoReceivedWhatsAppMode = "live" | "dry-run" | "off";

/**
 * Reads NOTIFICATION_ENGINE_WHATSAPP_MODE — the SAME env var name already
 * used by apps/api's WhatsAppEngineConfigService.getMode() and by
 * `getSupplierRfqReceivedWhatsAppMode()` above. Never a second/renamed env
 * var.
 */
export function getSupplierPoReceivedWhatsAppMode(): SupplierPoReceivedWhatsAppMode {
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

/** Builds the canonical dedupe identity for a specific PO issuance to a specific supplier — see doc comment above. */
export function buildSupplierPoReceivedDedupeKey(purchaseOrderId: string, supplierId: string): string {
  return `${EVENT_TYPE}:${purchaseOrderId}:${supplierId}`;
}

/**
 * Summarizes PurchaseOrderLineItem product names, truncated to
 * MAX_SUMMARY_ITEMS (+N more) — mirrors the exact existing truncation
 * convention used by WhatsAppLifecycleService.lineItemSummary /
 * NotificationService.buildOrderLineItemSummary elsewhere in this codebase.
 * Never reconstructs/derives a material name from anything other than the
 * canonical PurchaseOrderLineItem.product.name.
 */
export function summarizePoMaterials(lineItems: Array<{ product?: { name?: string | null } | null }>): string {
  if (!lineItems.length) return "your requested material";
  const names = lineItems.slice(0, MAX_SUMMARY_ITEMS).map((li) => li.product?.name ?? "Item");
  if (lineItems.length > MAX_SUMMARY_ITEMS) names.push(`+${lineItems.length - MAX_SUMMARY_ITEMS} more`);
  return names.join(", ");
}

/**
 * Summarizes PurchaseOrderLineItem quantities (paired item-for-item with
 * `summarizePoMaterials`'s ordering/truncation), formatted
 * `${quantity} ${unit}` per item — identical format already used by
 * supplier-rfq-received-notification.ts for a single OrderItem's quantity.
 */
export function summarizePoQuantities(
  lineItems: Array<{ quantity: number; product?: { unit?: string | null } | null }>
): string {
  if (!lineItems.length) return "—";
  const quantities = lineItems
    .slice(0, MAX_SUMMARY_ITEMS)
    .map((li) => `${li.quantity}${li.product?.unit ? ` ${li.product.unit}` : ""}`);
  if (lineItems.length > MAX_SUMMARY_ITEMS) quantities.push(`+${lineItems.length - MAX_SUMMARY_ITEMS} more`);
  return quantities.join(", ");
}

/**
 * Low-level Meta Cloud API template send — exactly 3 body parameters, no
 * header. The approved template's static "View Purchase Order" QUICK_REPLY
 * button is rendered automatically by WhatsApp from the template definition
 * itself (it is not a dynamic URL button, so no extra `components` entry is
 * needed — see WhatsappNotificationService's doc comment). Mirrors
 * apps/api's WhatsappNotificationService.sendTemplateAlert / this package's
 * other *-notification.ts `sendTemplateViaMeta` byte-for-byte (same payload
 * shape, same WhatsAppMessageLog bookkeeping, same live/dry-run/off
 * branching) so every app produces identical audit-trail rows and identical
 * Meta payloads.
 */
async function sendTemplateViaMeta(
  prisma: SupplierPoReceivedPrismaClient,
  phone: string,
  templateName: string,
  parameters: string[],
  log: (message: string) => void
): Promise<{ success: boolean; externalId?: string; error?: string }> {
  const mode = getSupplierPoReceivedWhatsAppMode();

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
 * `evaluatePolicy` in supplier-rfq-received-notification.ts.
 */
async function evaluatePolicy(
  prisma: SupplierPoReceivedPrismaClient,
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
 * Notifies a supplier that a Purchase Order has been issued to them and is
 * now awaiting their review/acknowledgement, via the `supplier_po_alert`
 * Meta WhatsApp template, routed through the existing Notification Engine
 * tables (NotificationEventPolicy, NotificationEvent, NotificationGlobalSettings,
 * NotificationPreference, WhatsAppMessageLog).
 *
 * Callers MUST invoke this only after `PurchaseOrder.status` has already
 * been committed as ISSUED — never for a DRAFT PO.
 *
 * Never throws — every failure is caught and logged via `onLog`.
 */
export async function notifySupplierPoReceived(
  prisma: SupplierPoReceivedPrismaClient,
  params: NotifySupplierPoReceivedParams,
  onLog: (message: string) => void = () => undefined
): Promise<void> {
  const { purchaseOrderId } = params;

  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        supplier: { include: { user: true } },
        lineItems: { include: { product: true } },
      },
    });

    if (!po) {
      onLog(`SUPPLIER_PO_RECEIVED: purchaseOrder ${purchaseOrderId} not found — skipping notification`);
      return;
    }

    if (po.status !== "ISSUED") {
      onLog(
        `SUPPLIER_PO_RECEIVED: purchaseOrder ${purchaseOrderId} is not ISSUED (status=${po.status}) — skipping notification`
      );
      return;
    }

    const supplierId: string = po.supplierId;
    const supplierUser = po.supplier?.user;
    if (!supplierUser) {
      onLog(
        `SUPPLIER_PO_RECEIVED: no supplier/user found for purchaseOrder=${purchaseOrderId} supplier=${supplierId} — skipping notification`
      );
      return;
    }

    const phone = supplierUser.whatsappNumber?.trim() || supplierUser.phone?.trim() || null;

    const lineItems: Array<{ quantity: number; product?: { name?: string | null; unit?: string | null } | null }> =
      po.lineItems ?? [];
    const poDisplayId = po.poNumber ?? po.id;
    const material = summarizePoMaterials(lineItems);
    const quantity = summarizePoQuantities(lineItems);

    const dedupeKey = buildSupplierPoReceivedDedupeKey(purchaseOrderId, supplierId);

    const decision = await evaluatePolicy(prisma, supplierUser.id, dedupeKey);

    if (!decision.allowed) {
      await prisma.notificationEvent.create({
        data: {
          eventType: EVENT_TYPE,
          recipientId: supplierUser.id,
          recipientType: "supplier",
          entityType: "PurchaseOrder",
          entityId: purchaseOrderId,
          channel: CHANNEL,
          payload: { purchaseOrderId, orderId: po.orderId, supplierId, poNumber: poDisplayId, material, quantity },
          status: "suppressed",
          suppressReason: decision.reason,
        },
      });
      onLog(
        `SUPPLIER_PO_RECEIVED suppressed for purchaseOrder=${purchaseOrderId} supplier=${supplierId}: reason=${decision.reason}`
      );
      return;
    }

    const event = await prisma.notificationEvent.create({
      data: {
        eventType: EVENT_TYPE,
        recipientId: supplierUser.id,
        recipientType: "supplier",
        entityType: "PurchaseOrder",
        entityId: purchaseOrderId,
        channel: CHANNEL,
        dedupeKey,
        payload: { purchaseOrderId, orderId: po.orderId, supplierId, poNumber: poDisplayId, material, quantity },
        status: "created",
      },
    });

    if (!phone) {
      await prisma.notificationEvent.update({ where: { id: event.id }, data: { status: "failed" } });
      onLog(
        `SUPPLIER_PO_RECEIVED: no phone/whatsappNumber on file for purchaseOrder=${purchaseOrderId}, supplier=${supplierId} — skipping send`
      );
      return;
    }

    const sendResult = await sendTemplateViaMeta(
      prisma,
      phone,
      decision.templateName,
      [poDisplayId, material, quantity],
      onLog
    );

    await prisma.notificationEvent.update({ where: { id: event.id }, data: { status: sendResult.success ? "sent" : "failed" } });

    if (!sendResult.success) {
      onLog(
        `SUPPLIER_PO_RECEIVED WhatsApp send failed for purchaseOrder=${purchaseOrderId} supplier=${supplierId}: ${sendResult.error ?? "unknown error"}`
      );
    }
  } catch (error) {
    onLog(
      `SUPPLIER_PO_RECEIVED notification failed for purchaseOrder=${purchaseOrderId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
