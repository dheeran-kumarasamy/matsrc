import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { ListingsService } from "src/supplier/listings/listings.service";
import { SupplierDailyPriceCompletenessService } from "src/notification-engine/supplier-daily-price/supplier-daily-price-completeness.service";
import { SupplierDailyPriceReminderService } from "src/notification-engine/supplier-daily-price/supplier-daily-price-reminder.service";
import { WhatsAppAuthService, WhatsAppIdentity } from "../whatsapp-auth.service";
import { WhatsAppSessionService } from "../whatsapp-session.service";
import { WhatsAppAuditHelper } from "../whatsapp-audit.helper";
import { BotMessage, WhatsAppSession } from "../whatsapp.types";
import { parseDailyPriceReplyInput, parsePositiveNumber } from "../whatsapp.utils";

/**
 * Supplier Daily Price Update reply handler — Phase 1 (see task spec §4 and
 * §12-§21). This is a SEPARATE inbound workflow from the interactive
 * `PriceUpdateFlow` main-menu flow (spec §21: "Keep the two concerns
 * separate") — it reacts to a supplier replying directly to the
 * `supplier_price_update` WhatsApp template (outside the bot's menu
 * navigation), not to a menu selection.
 *
 * "Active daily price-update session" is deliberately NOT a new Prisma model
 * (repository audit, task spec §10): the existing `NotificationEvent` row
 * created by `SupplierDailyPriceReminderService.evaluateAndNotify()` for
 * `SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED` already IS that session — keyed by
 * the same `dedupeKey` (`SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:{supplierId}:{businessDate}`)
 * and resolved (`status: "resolved"`) by the same `resolveIfComplete()` this
 * flow also calls. An unresolved `NotificationEvent` for today's dedupe key
 * is "PENDING/IN_PROGRESS/PARTIAL"; once resolved it is "COMPLETED"; absent
 * entirely (supplier was never reminded) it is treated as "no active
 * session" (spec §9/§25 — never mutate a price with no known active
 * session).
 *
 * Canonical pricing: every accepted price is written via
 * `ListingsService.update()` — the exact same mutation the interactive
 * `PriceUpdateFlow` and the Supplier portal UI use — so `PriceSnapshot`
 * history, watchlist alerts, and `/products`' live (uncached) read all stay
 * correct automatically. This flow never writes `Product.basePrice`
 * directly and never touches `PricingTier`/`aggregationPriceTiers`.
 */
@Injectable()
export class SupplierDailyPriceReplyFlow {
  private readonly logger = new Logger(SupplierDailyPriceReplyFlow.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: WhatsAppAuthService,
    private readonly sessionService: WhatsAppSessionService,
    private readonly listingsService: ListingsService,
    private readonly completeness: SupplierDailyPriceCompletenessService,
    private readonly dailyPriceReminder: SupplierDailyPriceReminderService,
    private readonly audit: WhatsAppAuditHelper
  ) {}

  /**
   * Returns `null` when the inbound text is not a daily-price reply, the
   * sender cannot be identified, or there is no active session — in every
   * such case the caller (WhatsAppRouterService) falls through to its
   * normal, already-safe handling (menu / registration-required message).
   * Never throws.
   */
  async tryHandle(phone: string, text: string, existingSession: WhatsAppSession | undefined): Promise<BotMessage | null> {
    const pairs = parseDailyPriceReplyInput(text);
    if (pairs.length === 0) {
      return null;
    }

    const identity = existingSession
      ? ({
          userId: existingSession.userId,
          supplierProfileId: existingSession.supplierProfileId,
          email: existingSession.email,
          name: existingSession.name,
          language: existingSession.language,
        } satisfies WhatsAppIdentity)
      : await this.authService.resolveByVerifiedNumber(phone);

    // Security requirement (spec §25): an incoming message must NEVER update
    // a price unless the sender resolves to a known, verified supplier
    // account via the existing canonical identity mapping. No approximate
    // phone matching is ever performed.
    if (!identity) {
      this.logger.warn(`Daily price reply from unrecognized WhatsApp number — no price update applied`);
      return null;
    }

    const businessDate = this.completeness.getBusinessDateKey();
    const dedupeKey = this.dedupeKey(identity.supplierProfileId, businessDate);

    const activeSession = await this.prisma.notificationEvent.findUnique({ where: { dedupeKey } });
    if (!activeSession || activeSession.status === "resolved") {
      this.logger.debug(
        `No active daily price-update session for supplier=${identity.supplierProfileId} businessDate=${businessDate} — ignoring reply`
      );
      return null;
    }

    const expectedProducts = await this.prisma.product.findMany({
      where: { supplierId: identity.supplierProfileId, isActive: true },
      select: { id: true, name: true },
    });

    const accepted: string[] = [];
    const rejectedUnknown: string[] = [];
    const rejectedInvalid: string[] = [];

    for (const pair of pairs) {
      // Exact (case-insensitive) match only against THIS supplier's own
      // active listings — spec §14: "Only accept products that are actually
      // part of that supplier's current price-update session." No fuzzy
      // matching that could silently map one product to another (spec §13).
      const product = expectedProducts.find((p) => p.name.trim().toLowerCase() === pair.product.trim().toLowerCase());
      if (!product) {
        rejectedUnknown.push(pair.product);
        continue;
      }

      const price = parsePositiveNumber(pair.price);
      if (price === null) {
        rejectedInvalid.push(`${pair.product} ("${pair.price}")`);
        continue;
      }

      // Duplicate-processing guard (spec §20), additional to the webhook
      // controller's per-Meta-message-id dedup: the SAME product+price for
      // the SAME supplier+business-date is only ever applied once, even if
      // received across two separate inbound messages/deliveries.
      const idempotencyKey = `daily-price-reply:${identity.supplierProfileId}:${businessDate}:${product.id}:${price}`;
      await this.sessionService.withIdempotency(idempotencyKey, async () => {
        await this.listingsService.update(
          product.id,
          { price: String(price) },
          { userId: identity.userId, email: identity.email, name: identity.name }
        );
        await this.audit.record({
          actorId: identity.userId,
          action: "PRICE_UPDATE",
          entityType: "Product",
          entityId: product.id,
          metadata: { newPrice: String(price), source: "whatsapp_daily_price_reply", businessDate },
        });
      });

      accepted.push(product.name);
    }

    // Re-evaluate completeness AFTER applying the accepted updates — this is
    // the single source of truth for PARTIAL vs COMPLETE (spec §18/§19),
    // reusing SupplierDailyPriceCompletenessService rather than tracking a
    // separate "updated/remaining" list in this flow.
    const finalEvaluation = await this.completeness.evaluateSupplier(identity.supplierProfileId);
    const stillMissing = finalEvaluation.missingProducts.map((p) => p.name);

    if (accepted.length > 0 && stillMissing.length === 0) {
      // Marks today's NotificationEvent `resolved` (spec §19 — session
      // COMPLETED). ListingsService.update() already calls this internally
      // per-product, but calling it again here is a cheap, idempotent
      // no-op safety net that guarantees the session is resolved even if
      // every individual update() call happened to run before the LAST
      // product became current (race-free: resolveIfComplete() always
      // re-reads live completeness itself).
      await this.dailyPriceReminder.resolveIfComplete(identity.supplierProfileId);
    }

    return this.buildReply(accepted, rejectedUnknown, rejectedInvalid, stillMissing);
  }

  private dedupeKey(supplierId: string, businessDate: string): string {
    return `SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:${supplierId}:${businessDate}`;
  }

  /**
   * Builds the outbound confirmation as plain text sent through the
   * existing `WhatsAppSendAdapter` session-message path (spec §19: no new
   * unapproved Meta template is used for this confirmation — it rides the
   * open customer-service-window session message, exactly like every other
   * bot reply in this module).
   */
  private buildReply(
    accepted: string[],
    rejectedUnknown: string[],
    rejectedInvalid: string[],
    stillMissing: string[]
  ): BotMessage {
    const sections: string[] = [];

    if (accepted.length > 0) {
      sections.push(`Price update received for:\n${accepted.map((name) => `✓ ${name}`).join("\n")}`);
    }

    if (rejectedUnknown.length > 0) {
      sections.push(
        `⚠️ Not part of your active listings — no change made:\n${rejectedUnknown.map((name) => `- ${name}`).join("\n")}`
      );
    }

    if (rejectedInvalid.length > 0) {
      sections.push(`⚠️ Invalid price — not saved:\n${rejectedInvalid.map((entry) => `- ${entry}`).join("\n")}`);
    }

    if (accepted.length === 0 && rejectedUnknown.length === 0 && rejectedInvalid.length === 0) {
      sections.push("Couldn't process that price update. Please use the format: Product: Price");
    }

    if (stillMissing.length > 0) {
      sections.push(`Still required:\n${stillMissing.map((name) => `- ${name}`).join("\n")}`);
    } else if (accepted.length > 0) {
      sections.push("Today's price update has been received successfully for all required products.\n\nThank you.");
    }

    return { kind: "text", text: sections.join("\n\n") };
  }
}
