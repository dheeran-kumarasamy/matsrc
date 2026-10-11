import { Injectable, Logger } from "@nestjs/common";
import { parsePhoneNumber } from "libphonenumber-js";
import { findIdentity } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { BotMessage } from "../whatsapp.types";

/**
 * Normalizes a Meta webhook inbound phone (`message.from`/`wa_id`) to the
 * E.164 format `AuthIdentity.providerIdentifier` stores for WhatsApp
 * identities (see packages/db/lib/identity-resolution.ts and
 * apps/web/app/api/auth/verify-otp/route.ts's `normalizePhone`). Meta's
 * inbound phone is ALREADY a full international number with no leading `+`
 * (e.g. "919876543210", confirmed against Meta's own webhook reference) —
 * unlike `apps/api/src/common/validators/phone.validator.ts`'s
 * `normalizePhoneNumber`, which assumes a LOCAL number and prepends a
 * country code, this must only ever prepend the literal `+` and parse,
 * never re-prepend "91". Deliberately a separate, narrowly-scoped function
 * rather than reusing/altering that shared validator, which other call
 * sites correctly rely on for local-number input.
 */
function normalizeInboundWhatsAppPhone(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  try {
    const candidate = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
    const parsed = parsePhoneNumber(candidate);
    return parsed && parsed.isValid() ? parsed.format("E.164") : null;
  } catch {
    return null;
  }
}

/**
 * InboundTemplateReplyFlow — handles a WhatsApp user tapping a quick-reply
 * button on one of the Notification Engine's outbound Meta templates
 * (`supplier_quote_alert`, `supplier_po_alert`, `payment_required`,
 * `quote_received`).
 *
 * BACKGROUND (C41 root cause — see repository investigation): Meta delivers
 * a quick-reply TEMPLATE button tap as an inbound webhook message with
 * `type: "button"` and a `button: { text, payload }` object, PLUS a
 * `context.id` pointing at the wamid of the outbound template message the
 * button belongs to (confirmed against Meta's own webhook reference:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button).
 * This is a COMPLETELY SEPARATE shape from `interactive.button_reply`, which
 * only ever describes a tap on a Reply Button/List message the Supplier bot
 * itself sent as part of its menu flows (PriceUpdateFlow,
 * EnquiryDecisionFlow, etc). Before this flow existed, `type: "button"`
 * messages were never parsed by the webhook controller at all, so every
 * quick-reply template button tap silently produced no reply whatsoever
 * (falling through to the simplified mock-shape fallback in
 * `extractInboundMessage`, which has no `phone`/`from` field on a real Meta
 * payload and returns `null`).
 *
 * TEMPLATES COVERED (confirmed QUICK_REPLY buttons — tapping generates a
 * real inbound webhook; see packages/db/scripts/seed-notification-templates.js
 * and each notification module's own doc comment for the Meta-verified
 * button type of each template):
 *   - `supplier_quote_alert` ("Review RFQ")       -> SUPPLIER_RFQ_RECEIVED  (OrderItem)
 *   - `supplier_po_alert` ("View Purchase Order") -> SUPPLIER_PO_RECEIVED   (PurchaseOrder)
 *   - `payment_required` ("Make Payment")         -> PAYMENT_REQUIRED      (Order)
 *   - `quote_received` ("View Quote")             -> QUOTE_RECEIVED        (Order)
 *
 * NOT covered (explicitly, deliberately out of scope — do not guess):
 *   - `buildohub_login_otp`'s "Copy code" button is a URL button (Meta's
 *     COPY_CODE-via-URL-button mechanism), not a QUICK_REPLY button — tapping
 *     it is pure client-side navigation/copy, generating NO inbound webhook
 *     at all. There is nothing to route here, and nothing was changed about it.
 *   - `customer_order_status` has no buttons at all (confirmed in its own
 *     module's doc comment: "No header, no buttons").
 *   - `action_reminder_alert` / `supplier_rfq_reminder` have NO implemented
 *     business-trigger service anywhere in this repository (only a
 *     NotificationEventPolicy registry row + the Admin manual test-send
 *     panel reference them) — there is no real RFQ/PO/order this reply could
 *     be confidently mapped to, so this flow does not attempt to handle them.
 *     A tap on either falls through to the existing safe fallback unchanged.
 *
 * CORRELATION (trusted, never guessed from button label text alone):
 *   inbound `context.id` (the original template message's wamid)
 *     -> WhatsAppMessageLog.findUnique({ where: { metaMessageId } })  (phoneNumber, templateName)
 *     -> templateName mapped to its eventType via a fixed, explicit map below
 *        (mirrors the exact eventType/templateName pairing already seeded in
 *        packages/db/scripts/seed-notification-templates.js — never invented)
 *     -> the most recent NotificationEvent for that eventType whose
 *        recipientId's own on-file phone/whatsappNumber matches the
 *        WhatsAppMessageLog's phoneNumber (never just "any event for this
 *        eventType" — the recipientId is always re-verified against the
 *        INBOUND phone number, never merely assumed from the log row, since
 *        WhatsAppMessageLog does not itself store recipientId).
 *
 * AUTHORIZATION (re-verified every time, never trusted from the payload):
 *   - Buyer-side: the inbound phone is resolved to a BUILDER User via the
 *     existing AuthIdentity mechanism (`findIdentity`, provider "WHATSAPP",
 *     role "BUILDER") — exactly the same mechanism the WhatsApp Login OTP
 *     flow already uses. The resolved userId must equal
 *     `NotificationEvent.recipientId` before any Order/Quote/Payment detail
 *     is read or returned.
 *   - Supplier-side: resolved via the existing
 *     `WhatsAppAuthService.resolveByVerifiedNumber()` gate (unchanged), and
 *     the resolved userId must equal `NotificationEvent.recipientId` before
 *     any RFQ/PO detail is read or returned.
 *   - If identity resolution fails, or the resolved identity does not match
 *     the NotificationEvent's recipient, this flow returns `null` (safe,
 *     generic fallback handled by the caller — WhatsAppRouterService) rather
 *     than ever returning a different user's business data.
 *
 * PAYMENT SAFETY: `payment_required`'s "Make Payment" reply NEVER marks an
 * Order as paid or writes to PaymentVerification/any payment ledger — it
 * only explains the next step and links to the existing, already-built
 * authenticated payment page (`/orders/{id}/payment`). No new payment
 * lifecycle is introduced.
 *
 * Never throws — every failure (DB error, ambiguous correlation, missing
 * identity) is caught and logged, returning `null` so the caller falls back
 * to its existing, already-safe handling.
 */

type TemplateEventMapping = {
  eventType: "SUPPLIER_RFQ_RECEIVED" | "SUPPLIER_PO_RECEIVED" | "PAYMENT_REQUIRED" | "QUOTE_RECEIVED";
  audience: "supplier" | "builder";
};

/**
 * Fixed, explicit templateName -> (eventType, audience) map — mirrors EXACTLY
 * the eventType/templateName/channel rows already seeded in
 * packages/db/scripts/seed-notification-templates.js. Never inferred/guessed;
 * extending this map requires the same evidence trail as adding a new
 * business-trigger notification module.
 */
const TEMPLATE_EVENT_MAP: Record<string, TemplateEventMapping> = {
  supplier_quote_alert: { eventType: "SUPPLIER_RFQ_RECEIVED", audience: "supplier" },
  supplier_po_alert: { eventType: "SUPPLIER_PO_RECEIVED", audience: "supplier" },
  payment_required: { eventType: "PAYMENT_REQUIRED", audience: "builder" },
  quote_received: { eventType: "QUOTE_RECEIVED", audience: "builder" },
};

function builderPortalBaseUrl(): string {
  return (process.env.BUILDER_PORTAL_URL || process.env.NEXT_PUBLIC_APP_URL || "https://web-sable-nine-97.vercel.app").replace(/\/$/, "");
}

function supplierPortalBaseUrl(): string {
  return (process.env.SUPPLIER_PORTAL_URL || process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app").replace(/\/$/, "");
}

@Injectable()
export class InboundTemplateReplyFlow {
  private readonly logger = new Logger(InboundTemplateReplyFlow.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns `null` when the inbound message is not a recognized
   * quick-reply template button tap, the originating template send cannot
   * be correlated, or the caller's identity cannot be safely authorized
   * against the originating NotificationEvent's recipient — in every such
   * case the router falls through to its existing, already-safe handling
   * (menu / registration-required message). Never throws.
   */
  async tryHandle(
    phone: string,
    context: { templateButtonPayload?: string; templateMessageId?: string } | undefined
  ): Promise<BotMessage | null> {
    if (!context?.templateMessageId) {
      return null;
    }

    try {
      const log = await this.prisma.whatsAppMessageLog.findUnique({
        where: { metaMessageId: context.templateMessageId },
      });

      if (!log) {
        this.logger.debug(
          `InboundTemplateReplyFlow: no WhatsAppMessageLog found for templateMessageId — ignoring reply`
        );
        return null;
      }

      const mapping = TEMPLATE_EVENT_MAP[log.templateName];
      if (!mapping) {
        // Not one of the 4 templates this flow handles (e.g. a reminder
        // template with no implemented trigger, or a template this flow
        // deliberately does not cover) — safe no-op, never guessed.
        return null;
      }

      // The inbound phone must match the phone this specific template send
      // actually targeted — never trust button payload/text alone.
      if (log.phoneNumber !== phone) {
        this.logger.warn(
          `InboundTemplateReplyFlow: inbound phone does not match WhatsAppMessageLog.phoneNumber for templateName=${log.templateName} — ignoring reply`
        );
        return null;
      }

      const event = await this.findMatchingEvent(mapping.eventType, phone);
      if (!event) {
        return null;
      }

      if (mapping.eventType === "SUPPLIER_RFQ_RECEIVED" || mapping.eventType === "SUPPLIER_PO_RECEIVED") {
        return this.handleSupplierReply(mapping.eventType, event, phone);
      }

      return this.handleBuilderReply(mapping.eventType, event, phone);
    } catch (error) {
      this.logger.warn(
        `InboundTemplateReplyFlow failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Finds the most recent NotificationEvent of `eventType` whose
   * `recipientId` resolves to a User whose own on-file
   * whatsappNumber/phone equals `phone` — the recipientId re-verification
   * step described in this file's CORRELATION doc comment above.
   */
  private async findMatchingEvent(eventType: string, phone: string) {
    const candidates = await this.prisma.notificationEvent.findMany({
      where: { eventType, channel: "WHATSAPP", status: { in: ["sent", "created"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    for (const candidate of candidates) {
      const recipient = await this.prisma.user.findUnique({
        where: { id: candidate.recipientId },
        select: { whatsappNumber: true, phone: true },
      });
      const recipientPhone = recipient?.whatsappNumber?.trim() || recipient?.phone?.trim();
      if (recipientPhone === phone) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Supplier-side reply ("Review RFQ" / "View Purchase Order"). Re-verifies
   * the supplier's own phone resolves to the SupplierProfile that actually
   * owns the RFQ/PO referenced by the matched NotificationEvent before
   * returning any detail — never trusts the event row alone.
   */
  private async handleSupplierReply(
    eventType: "SUPPLIER_RFQ_RECEIVED" | "SUPPLIER_PO_RECEIVED",
    event: { recipientId: string; entityId: string | null; payload: any },
    phone: string
  ): Promise<BotMessage | null> {
    const supplierUser = await this.prisma.user.findFirst({
      where: { id: event.recipientId, role: "SUPPLIER", OR: [{ whatsappNumber: phone }, { phone }] },
      include: { supplierProfile: true },
    });

    if (!supplierUser?.supplierProfile) {
      this.logger.warn(`InboundTemplateReplyFlow: could not re-authenticate supplier for eventType=${eventType}`);
      return null;
    }

    const supplierProfileId = supplierUser.supplierProfile.id;

    if (eventType === "SUPPLIER_RFQ_RECEIVED") {
      const orderItem = await this.prisma.orderItem.findFirst({
        where: { id: event.entityId ?? undefined, supplierId: supplierProfileId },
        include: { order: true, product: true },
      });

      if (!orderItem) {
        return null;
      }

      const deepLink = `${supplierPortalBaseUrl()}/orders/${orderItem.orderId}?respond=${orderItem.orderId}`;
      return {
        kind: "text",
        text:
          `RFQ for ${orderItem.product.name} (${orderItem.quantity} ${orderItem.product.unit})\n` +
          `Enquiry #${orderItem.order.enquiryId ?? orderItem.orderId}\n\n` +
          `Review and submit your quotation here: ${deepLink}`,
      };
    }

    // SUPPLIER_PO_RECEIVED
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: event.entityId ?? undefined, supplierId: supplierProfileId },
    });

    if (!po) {
      return null;
    }

    const deepLink = `${supplierPortalBaseUrl()}/purchase-orders/${po.id}`;
    return {
      kind: "text",
      text: `Purchase Order ${po.poNumber}\n\nView and act on it here: ${deepLink}`,
    };
  }

  /**
   * Builder/buyer-side reply ("Make Payment" / "View Quote"). Resolves the
   * inbound phone to a BUILDER User via the existing AuthIdentity mechanism
   * (the same one the WhatsApp Login OTP flow uses) and re-verifies that
   * resolved userId equals the matched NotificationEvent's recipientId
   * before returning any Order/Quote/Payment detail.
   */
  private async handleBuilderReply(
    eventType: "PAYMENT_REQUIRED" | "QUOTE_RECEIVED",
    event: { recipientId: string; entityId: string | null },
    phone: string
  ): Promise<BotMessage | null> {
    const normalized = normalizeInboundWhatsAppPhone(phone);
    if (!normalized) {
      return null;
    }

    const identity = await findIdentity(this.prisma as any, {
      provider: "WHATSAPP",
      providerIdentifier: normalized,
      role: "BUILDER",
    });

    if (!identity || identity.userId !== event.recipientId) {
      this.logger.warn(`InboundTemplateReplyFlow: could not re-authenticate builder for eventType=${eventType}`);
      return null;
    }

    const order = await this.prisma.order.findFirst({
      where: { id: event.entityId ?? undefined, userId: identity.userId },
    });

    if (!order) {
      return null;
    }

    const enquiryDisplayId = order.enquiryId ?? order.id;

    if (eventType === "PAYMENT_REQUIRED") {
      // Payment safety: this reply only explains the next step and links to
      // the existing, already-built authenticated payment page — it NEVER
      // marks the order paid, writes to PaymentVerification, or infers
      // success from this reply. The actual payment proof submission still
      // only happens through the existing authenticated web flow.
      const deepLink = `${builderPortalBaseUrl()}/orders/${order.id}/payment`;
      return {
        kind: "text",
        text:
          `To complete payment for enquiry ${enquiryDisplayId}, please use the secure payment page on your Buildohub account:\n${deepLink}\n\n` +
          `We are unable to process payments over WhatsApp.`,
      };
    }

    // QUOTE_RECEIVED
    const deepLink = `${builderPortalBaseUrl()}/orders/${order.id}`;
    return {
      kind: "text",
      text: `A supplier has submitted a quotation for enquiry ${enquiryDisplayId}. Review it here: ${deepLink}`,
    };
  }
}
