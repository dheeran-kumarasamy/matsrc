import { randomUUID } from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { ListingsService } from "src/supplier/listings/listings.service";
import { SupplierDailyPriceCompletenessService } from "src/notification-engine/supplier-daily-price/supplier-daily-price-completeness.service";
import { SupplierDailyPriceReminderService } from "src/notification-engine/supplier-daily-price/supplier-daily-price-reminder.service";
import {
  buildDailyPriceDedupeKey,
  DailyPriceNotificationPayload,
  DailyPricePendingPreview,
  DailyPricePreviewLine,
  isPendingPreviewExpired,
  parseDailyPricePayload,
  supplierPricingDeepLink,
} from "src/notification-engine/supplier-daily-price/supplier-daily-price.util";
import { WhatsAppAuthService, WhatsAppIdentity } from "../whatsapp-auth.service";
import { WhatsAppSessionService } from "../whatsapp-session.service";
import { WhatsAppAuditHelper } from "../whatsapp-audit.helper";
import { BotMessage, WhatsAppSession } from "../whatsapp.types";
import { isSameKeyword, isWithinSoftRange, parseDailyPriceReplyInput, parsePositiveNumber } from "../whatsapp.utils";

type ActiveProductRow = { id: string; name: string; unit: string; basePrice: unknown };

type ResolvedLine =
  | { status: "CHANGE"; productId: string; productName: string; unit: string | null; currentPrice: number; proposedPrice: number }
  | { status: "SAME"; productId: string; productName: string; unit: string | null; currentPrice: number }
  | { status: "REJECTED"; rawProduct: string; reason: string };

/**
 * Supplier Daily Price Update reply handler — Phase 1 (see task spec §4 and
 * §12-§21). This is a SEPARATE inbound workflow from the interactive
 * `PriceUpdateFlow` main-menu flow (spec §21: "Keep the two concerns
 * separate") — it reacts to a supplier replying directly to the
 * `supplier_price_update` WhatsApp template (outside the bot's menu
 * navigation), not to a menu selection.
 *
 * "Active daily price-update session" is deliberately NOT a new Prisma model:
 * the existing `NotificationEvent` row created by
 * `SupplierDailyPriceReminderService.evaluateAndNotify()` for
 * `SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED` already IS that session — keyed by
 * the same `dedupeKey` (`SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:{supplierId}:{businessDate}`)
 * and resolved (`status: "resolved"`) by the same `resolveIfComplete()` this
 * flow also calls. An unresolved `NotificationEvent` for today's dedupe key
 * is the active session; absent entirely or already resolved is treated as
 * "no active session" — a reply is never applied against a missing/resolved
 * session.
 *
 * Preview/Confirm/Cancel lifecycle: a validated, fully-correct multi-line
 * reply is staged as a `pendingPreview` INSIDE that same `NotificationEvent`
 * row's `payload` JSON column (see supplier-daily-price.util.ts) — never in
 * process memory — so it survives across serverless instances/invocations.
 * Nothing is written to `Product`/`PriceSnapshot`/`AuditLog` until the
 * supplier explicitly replies `CONFIRM`, at which point the preview is
 * atomically "claimed" via a conditional `updateMany` keyed on the
 * preview's own random `previewToken` still matching (the same
 * optimistic-concurrency pattern already used for order confirmation races
 * elsewhere in this codebase), so a duplicate/concurrent CONFIRM can never
 * re-apply the same preview twice.
 *
 * Canonical pricing: every accepted CHANGE line is written via
 * `ListingsService.update()` — the exact same mutation the interactive
 * `PriceUpdateFlow` and the Supplier portal UI use — so `PriceSnapshot`
 * history, watchlist alerts, and `/products`' live (uncached) read all stay
 * correct automatically. This flow never writes `Product.basePrice`
 * directly for a SAME line, and never touches `PricingTier`/
 * `aggregationPriceTiers` (WhatsApp supports base price only — tier pricing
 * remains portal-only).
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
   * Returns `null` when the inbound text is not a daily-price reply (and
   * not CONFIRM/CANCEL), the sender cannot be identified, or there is no
   * active session — in every such case the caller (WhatsAppRouterService)
   * falls through to its normal, already-safe handling (menu /
   * registration-required message). Never throws.
   *
   * Deliberately preserves the existing contract that plain conversational
   * text (zero parseable price lines, not CONFIRM/CANCEL) returns `null`
   * WITHOUT ever calling `authService` — ordinary greetings/menu navigation
   * must never be swallowed by this flow.
   */
  async tryHandle(phone: string, text: string, existingSession: WhatsAppSession | undefined): Promise<BotMessage | null> {
    const upper = text.trim().toUpperCase();
    const isConfirmCommand = upper === "CONFIRM";
    const isCancelCommand = upper === "CANCEL";
    const pairs = parseDailyPriceReplyInput(text);

    if (!isConfirmCommand && !isCancelCommand && pairs.length === 0) {
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

    // Security requirement: an incoming message must NEVER update a price
    // (or even reveal supplier-specific prices) unless the sender resolves
    // to a known, verified supplier account via the existing canonical
    // identity mapping. No approximate phone matching is ever performed,
    // and nothing in the message body (a product id/name/supplier id) is
    // ever trusted for authorization.
    if (!identity) {
      this.logger.warn(`Daily price reply from unrecognized WhatsApp number — no price update applied`);
      return null;
    }

    const businessDate = this.completeness.getBusinessDateKey();
    const dedupeKey = buildDailyPriceDedupeKey(identity.supplierProfileId, businessDate);

    const activeSession = await this.prisma.notificationEvent.findUnique({ where: { dedupeKey } });
    if (!activeSession || activeSession.status === "resolved") {
      this.logger.debug(
        `No active daily price-update session for supplier=${identity.supplierProfileId} businessDate=${businessDate} — ignoring reply`
      );
      return null;
    }

    if (isConfirmCommand) {
      return this.handleConfirm(identity, activeSession.id, businessDate);
    }
    if (isCancelCommand) {
      return this.handleCancel(activeSession.id);
    }

    return this.handlePriceLines(identity, activeSession.id, businessDate, pairs);
  }

  // ─────────────────────────────────────────────
  // Price-line parsing/validation -> preview creation
  // ─────────────────────────────────────────────

  private async handlePriceLines(
    identity: WhatsAppIdentity,
    notificationEventId: string,
    businessDate: string,
    pairs: Array<{ product: string; price: string }>
  ): Promise<BotMessage> {
    const activeProducts = await this.prisma.product.findMany({
      where: { supplierId: identity.supplierProfileId, isActive: true },
      select: { id: true, name: true, unit: true, basePrice: true },
    });

    const byNormalizedName = new Map<string, ActiveProductRow[]>();
    for (const product of activeProducts) {
      const key = product.name.trim().toLowerCase();
      const bucket = byNormalizedName.get(key) ?? [];
      bucket.push(product);
      byNormalizedName.set(key, bucket);
    }

    // Duplicate-LINE detection: the same normalized product name appearing
    // more than once in this single reply. Never let line order silently
    // decide the outcome — every line for that name is rejected and the
    // supplier is asked to resend a single, unambiguous line per product.
    const nameOccurrences = new Map<string, number>();
    for (const pair of pairs) {
      const key = pair.product.trim().toLowerCase();
      nameOccurrences.set(key, (nameOccurrences.get(key) ?? 0) + 1);
    }

    const resolved: ResolvedLine[] = [];

    for (const pair of pairs) {
      const normalized = pair.product.trim().toLowerCase();

      if ((nameOccurrences.get(normalized) ?? 0) > 1) {
        resolved.push({
          status: "REJECTED",
          rawProduct: pair.product,
          reason: "appears more than once in this message — send a single line per product",
        });
        continue;
      }

      const matches = byNormalizedName.get(normalized) ?? [];

      if (matches.length === 0) {
        resolved.push({ status: "REJECTED", rawProduct: pair.product, reason: "not part of your active listings" });
        continue;
      }

      if (matches.length > 1) {
        const detail = matches
          .map((m) => `${m.name} — current ₹${String(m.basePrice)} / ${m.unit} (id ...${m.id.slice(-6)})`)
          .join("; ");
        resolved.push({
          status: "REJECTED",
          rawProduct: pair.product,
          reason: `matches ${matches.length} of your active listings with the same name (${detail}) — update this one in the portal: ${supplierPricingDeepLink()}`,
        });
        continue;
      }

      const product = matches[0];
      const currentPrice = this.usableCurrentPrice(product.basePrice);

      if (isSameKeyword(pair.price)) {
        if (currentPrice === null) {
          resolved.push({
            status: "REJECTED",
            rawProduct: pair.product,
            reason: "has no valid current price on file — enter a numeric price instead, or update it in the portal",
          });
          continue;
        }
        resolved.push({ status: "SAME", productId: product.id, productName: product.name, unit: product.unit, currentPrice });
        continue;
      }

      const proposedPrice = parsePositiveNumber(pair.price);
      if (proposedPrice === null) {
        resolved.push({ status: "REJECTED", rawProduct: pair.product, reason: `invalid price "${pair.price}"` });
        continue;
      }

      if (currentPrice !== null && !isWithinSoftRange(proposedPrice, currentPrice)) {
        resolved.push({
          status: "REJECTED",
          rawProduct: pair.product,
          reason: `₹${proposedPrice} deviates more than 80% from the current price (₹${currentPrice}) — re-enter to confirm this is correct, or update it in the portal`,
        });
        continue;
      }

      resolved.push({
        status: "CHANGE",
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        currentPrice: currentPrice ?? proposedPrice,
        proposedPrice,
      });
    }

    const rejected = resolved.filter((line): line is Extract<ResolvedLine, { status: "REJECTED" }> => line.status === "REJECTED");

    if (rejected.length > 0) {
      return this.buildCorrectionNeededReply(rejected, identity.supplierProfileId);
    }

    const changeLines = resolved.filter((line): line is Extract<ResolvedLine, { status: "CHANGE" }> => line.status === "CHANGE");
    const sameLines = resolved.filter((line): line is Extract<ResolvedLine, { status: "SAME" }> => line.status === "SAME");

    const previewLines: DailyPricePreviewLine[] = [
      ...changeLines.map((line) => ({
        kind: "CHANGE" as const,
        productId: line.productId,
        productName: line.productName,
        unit: line.unit,
        currentPriceAtPreview: String(line.currentPrice),
        proposedPrice: String(line.proposedPrice),
      })),
      ...sameLines.map((line) => ({
        kind: "SAME" as const,
        productId: line.productId,
        productName: line.productName,
        unit: line.unit,
        currentPriceAtPreview: String(line.currentPrice),
      })),
    ];

    const pendingPreview: DailyPricePendingPreview = {
      previewToken: randomUUID(),
      createdAt: new Date().toISOString(),
      lines: previewLines,
    };

    const current = await this.prisma.notificationEvent.findUnique({ where: { id: notificationEventId } });
    const payload = parseDailyPricePayload(current?.payload);
    const newPayload: DailyPriceNotificationPayload = { ...payload, pendingPreview };

    await this.prisma.notificationEvent.update({ where: { id: notificationEventId }, data: { payload: newPayload as any } });

    return this.buildPreviewReply(changeLines, sameLines);
  }

  // ─────────────────────────────────────────────
  // CONFIRM
  // ─────────────────────────────────────────────

  private async handleConfirm(identity: WhatsAppIdentity, notificationEventId: string, businessDate: string): Promise<BotMessage> {
    const current = await this.prisma.notificationEvent.findUnique({ where: { id: notificationEventId } });
    if (!current) {
      return { kind: "text", text: "No pending price update found. Please send your price updates first, e.g. Product: Price" };
    }

    const payload = parseDailyPricePayload(current.payload);
    const pendingPreview = payload.pendingPreview ?? null;

    if (!pendingPreview) {
      return {
        kind: "text",
        text: "No pending preview found — it may already have been applied, cancelled, or never created. Please send your price updates first, e.g. Product: Price",
      };
    }

    if (isPendingPreviewExpired(pendingPreview)) {
      await this.prisma.notificationEvent.updateMany({
        where: { id: notificationEventId, payload: { path: ["pendingPreview", "previewToken"], equals: pendingPreview.previewToken } },
        data: { payload: { ...payload, pendingPreview: null } as any },
      });
      return { kind: "text", text: "Your preview has expired. Please resend your price updates, e.g. Product: Price" };
    }

    // Atomic claim — a conditional updateMany keyed on the preview's own
    // random token still matching the row's CURRENT payload. Only one
    // concurrent/duplicate CONFIRM can ever win this; a losing request's
    // updateMany returns count: 0 below and is told the update may already
    // be processed, rather than re-applying the same preview a second time.
    const claimedPayload: DailyPriceNotificationPayload = {
      ...payload,
      pendingPreview: null,
      confirmedSameProductIds: [
        ...(payload.confirmedSameProductIds ?? []),
        ...pendingPreview.lines.filter((l) => l.kind === "SAME").map((l) => l.productId),
      ],
    };

    const claim = await this.prisma.notificationEvent.updateMany({
      where: { id: notificationEventId, payload: { path: ["pendingPreview", "previewToken"], equals: pendingPreview.previewToken } },
      data: { payload: claimedPayload as any },
    });

    if (claim.count === 0) {
      return {
        kind: "text",
        text: "This update may have already been processed, or a newer preview was created. Please check your listings or resend your price updates.",
      };
    }

    // Re-read current Product records AFTER winning the claim — never
    // trust the prices/ownership captured when the preview was created. If
    // ANY referenced product drifted (price changed via the portal,
    // became inactive, or no longer belongs to this supplier) since the
    // preview was staged, the WHOLE preview is invalidated rather than
    // partially applied, so a multi-line confirmation can never leave some
    // products updated and others silently skipped.
    const productIds = pendingPreview.lines.map((l) => l.productId);
    const freshProducts = await this.prisma.product.findMany({
      where: { id: { in: productIds }, supplierId: identity.supplierProfileId, isActive: true },
      select: { id: true, name: true, unit: true, basePrice: true },
    });
    const freshById = new Map(freshProducts.map((p) => [p.id, p]));

    const stale: string[] = [];
    for (const line of pendingPreview.lines) {
      const fresh = freshById.get(line.productId);
      if (!fresh) {
        stale.push(`${line.productName} (no longer an active listing of yours)`);
        continue;
      }
      if (String(fresh.basePrice) !== line.currentPriceAtPreview) {
        stale.push(`${line.productName} (current price changed to ₹${String(fresh.basePrice)})`);
      }
    }

    if (stale.length > 0) {
      this.logger.warn(
        `Daily price preview invalidated at confirm time for supplier=${identity.supplierProfileId} businessDate=${businessDate}: ${stale.join(", ")}`
      );
      return {
        kind: "text",
        text: `Some of your listings changed since this preview was created, so nothing was applied:\n${stale
          .map((entry) => `- ${entry}`)
          .join("\n")}\n\nPlease resend your price updates to get a fresh preview.`,
      };
    }

    const appliedChanges: string[] = [];
    const confirmedSame: string[] = [];

    for (const line of pendingPreview.lines) {
      if (line.kind === "CHANGE") {
        await this.listingsService.update(
          line.productId,
          { price: line.proposedPrice },
          { userId: identity.userId, email: identity.email, name: identity.name }
        );
        await this.audit.record({
          actorId: identity.userId,
          action: "PRICE_UPDATE",
          entityType: "Product",
          entityId: line.productId,
          metadata: { newPrice: line.proposedPrice, source: "whatsapp_daily_price_reply", businessDate },
        });
        appliedChanges.push(`${line.productName}: ₹${line.proposedPrice}`);
      } else {
        // SAME confirmation — dedicated, idempotent audit path. Never
        // writes Product.basePrice, never creates a PriceSnapshot, never
        // triggers the watchlist price-hit check reserved for actual price
        // changes (ListingsService.update() is never called for this
        // branch at all).
        await this.recordSameConfirmation(identity, line, businessDate);
        confirmedSame.push(`${line.productName} (unchanged: ₹${line.currentPriceAtPreview})`);
      }
    }

    const finalEvaluation = await this.completeness.evaluateSupplier(identity.supplierProfileId);
    const stillMissing = finalEvaluation.missingProducts.map((p) => p.name);

    if (stillMissing.length === 0) {
      await this.dailyPriceReminder.resolveIfComplete(identity.supplierProfileId);
    }

    return this.buildConfirmedReply(appliedChanges, confirmedSame, stillMissing);
  }

  /**
   * Dedicated, idempotent SAME-confirmation audit write. Guards against a
   * duplicate audit record if this exact confirmation is ever replayed
   * (e.g. a retried request after a crash between the atomic preview claim
   * above and this write) by embedding a deterministic idempotency key in
   * the AuditLog metadata and checking for it first — belt-and-braces on
   * top of the preview-claim's own single-winner guarantee, specifically
   * for this write.
   */
  private async recordSameConfirmation(
    identity: WhatsAppIdentity,
    line: Extract<DailyPricePreviewLine, { kind: "SAME" }>,
    businessDate: string
  ): Promise<void> {
    const idempotencyKey = `same-confirm:${identity.supplierProfileId}:${businessDate}:${line.productId}`;

    const existing = await this.prisma.auditLog.findFirst({
      where: {
        entityType: "Product",
        entityId: line.productId,
        action: "PRICE_CONFIRMED_UNCHANGED",
        metadata: { path: ["idempotencyKey"], equals: idempotencyKey },
      },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    await this.audit.record({
      actorId: identity.userId,
      action: "PRICE_CONFIRMED_UNCHANGED",
      entityType: "Product",
      entityId: line.productId,
      metadata: {
        source: "whatsapp_daily_price_reply",
        businessDate,
        confirmedPrice: line.currentPriceAtPreview,
        idempotencyKey,
      },
    });
  }

  // ─────────────────────────────────────────────
  // CANCEL
  // ─────────────────────────────────────────────

  private async handleCancel(notificationEventId: string): Promise<BotMessage> {
    const current = await this.prisma.notificationEvent.findUnique({ where: { id: notificationEventId } });
    if (!current) {
      return { kind: "text", text: "Nothing to cancel." };
    }

    const payload = parseDailyPricePayload(current.payload);
    if (!payload.pendingPreview) {
      // Repeated/duplicate CANCEL is always harmless.
      return { kind: "text", text: "Nothing to cancel." };
    }

    await this.prisma.notificationEvent.updateMany({
      where: {
        id: notificationEventId,
        payload: { path: ["pendingPreview", "previewToken"], equals: payload.pendingPreview.previewToken },
      },
      data: { payload: { ...payload, pendingPreview: null } as any },
    });

    return { kind: "text", text: "Price update cancelled. No changes were made." };
  }

  // ─────────────────────────────────────────────
  // Reply builders
  // ─────────────────────────────────────────────

  private usableCurrentPrice(basePrice: unknown): number | null {
    const value = Number(basePrice);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private portalFooter(): string {
    return `WhatsApp updates base prices only — tier pricing and other listing details must be edited in the portal: ${supplierPricingDeepLink()}`;
  }

  private async buildCorrectionNeededReply(
    rejected: Array<Extract<ResolvedLine, { status: "REJECTED" }>>,
    supplierId: string
  ): Promise<BotMessage> {
    const evaluation = await this.completeness.evaluateSupplier(supplierId);
    const missingProducts = await this.prisma.product.findMany({
      where: { id: { in: evaluation.missingProducts.map((p) => p.id) } },
      select: { name: true, unit: true, basePrice: true },
    });

    const sections: string[] = [
      `⚠️ Some lines couldn't be processed — no changes were made yet:\n${rejected
        .map((line) => `- ${line.rawProduct}: ${line.reason}`)
        .join("\n")}`,
    ];

    if (missingProducts.length > 0) {
      sections.push(this.currentPriceListText(missingProducts));
    }

    sections.push(
      "Please resend a corrected message with one line per product, for example:\nProduct Name: 56500\nAnother Product: SAME"
    );
    sections.push(this.portalFooter());

    return { kind: "text", text: sections.join("\n\n") };
  }

  private buildPreviewReply(
    changeLines: Array<Extract<ResolvedLine, { status: "CHANGE" }>>,
    sameLines: Array<Extract<ResolvedLine, { status: "SAME" }>>
  ): BotMessage {
    const sections: string[] = ["Here's a preview of your price update:"];

    if (changeLines.length > 0) {
      sections.push(
        changeLines
          .map((line) => `${line.productName}: ₹${line.currentPrice} → ₹${line.proposedPrice}${line.unit ? ` / ${line.unit}` : ""}`)
          .join("\n")
      );
    }

    if (sameLines.length > 0) {
      sections.push(
        `Confirmed unchanged:\n${sameLines
          .map((line) => `${line.productName}: ₹${line.currentPrice}${line.unit ? ` / ${line.unit}` : ""} (SAME)`)
          .join("\n")}`
      );
    }

    sections.push("Nothing has been saved yet. Reply CONFIRM to apply this update, or CANCEL to discard it.");
    sections.push(this.portalFooter());

    return { kind: "text", text: sections.join("\n\n") };
  }

  private buildConfirmedReply(appliedChanges: string[], confirmedSame: string[], stillMissing: string[]): BotMessage {
    const sections: string[] = [];

    if (appliedChanges.length > 0) {
      sections.push(`✅ Prices updated:\n${appliedChanges.map((entry) => `- ${entry}`).join("\n")}`);
    }
    if (confirmedSame.length > 0) {
      sections.push(`✅ Confirmed unchanged:\n${confirmedSame.map((entry) => `- ${entry}`).join("\n")}`);
    }

    if (stillMissing.length > 0) {
      sections.push(`Still required for today:\n${stillMissing.map((name) => `- ${name}`).join("\n")}`);
    } else {
      sections.push("Today's price update is complete for all required products. Thank you.");
    }

    sections.push(this.portalFooter());

    return { kind: "text", text: sections.join("\n\n") };
  }

  private currentPriceListText(products: Array<{ name: string; unit: string | null; basePrice: unknown }>): string {
    const lines = products.map((product) => {
      const price = this.usableCurrentPrice(product.basePrice);
      const priceText = price === null ? "no valid current price on file" : `₹${price}`;
      const unitText = product.unit ? ` / ${product.unit}` : "";
      return `${product.name} — ${priceText}${price === null ? "" : unitText}`;
    });
    return `Here are your current base prices for today's update:\n${lines.map((line, i) => `${i + 1}. ${line}`).join("\n")}`;
  }
}

