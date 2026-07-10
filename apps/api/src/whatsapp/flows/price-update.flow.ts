import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { ListingsService } from "src/supplier/listings/listings.service";
import { WhatsAppSession, BotMessage, MENU_FOOTER } from "../whatsapp.types";
import { WhatsAppSessionService } from "../whatsapp-session.service";
import { WhatsAppAuditHelper } from "../whatsapp-audit.helper";
import { fuzzyMatch, isWithinSoftRange, parseBulkPriceInput, parsePositiveNumber } from "../whatsapp.utils";

/**
 * Flow 1 — Product Price Update (see spec §4).
 *
 * Reuses `ListingsService.update` directly (in-process DI, not an HTTP self-call) so the
 * public listings feed freshness SLA is identical to the portal path — no separate stale
 * cache is introduced.
 */
@Injectable()
export class PriceUpdateFlow {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listingsService: ListingsService,
    private readonly sessionService: WhatsAppSessionService,
    private readonly audit: WhatsAppAuditHelper
  ) {}

  async start(session: WhatsAppSession): Promise<BotMessage> {
    const listings = await this.prisma.product.findMany({
      where: { supplierId: session.supplierProfileId },
      orderBy: { updatedAt: "desc" },
      take: 8,
    });

    const active = listings.filter((listing) => listing.isActive);

    if (active.length === 0) {
      this.sessionService.resetToMainMenu(session.phone);
      const hasAny = listings.length > 0;
      return {
        kind: "text",
        text: hasAny
          ? `You have no active listings right now. Reactivate one from the Supplier portal first, then try again.\n\n${MENU_FOOTER}`
          : `You don't have any listings yet. Add one from the Supplier portal: ${process.env.SUPPLIER_PORTAL_URL || "https://matsrc-supplier.vercel.app"}/listings/new\n\n${MENU_FOOTER}`,
      };
    }

    this.sessionService.setFlow(session.phone, "PRICE_UPDATE", "SELECT_LISTING", {
      candidates: active.map((listing) => ({ id: listing.id, label: listing.name, price: listing.basePrice.toString() })),
    });

    return {
      kind: "list",
      header: "Product Price Update",
      body: "Select a listing to update its price, or type the product name to search.",
      rows: active.map((listing) => ({
        id: listing.id,
        title: listing.name,
        description: `Current: ₹${listing.basePrice.toString()} / ${listing.unit}`,
      })),
    };
  }

  async handle(session: WhatsAppSession, text: string): Promise<BotMessage> {
    switch (session.step) {
      case "SELECT_LISTING":
        return this.handleSelectListing(session, text);
      case "ENTER_PRICE":
        return this.handleEnterPrice(session, text);
      case "CONFIRM_PRICE":
        return this.handleConfirm(session, text);
      case "CONFIRM_OUT_OF_RANGE":
        return this.handleOutOfRangeConfirm(session, text);
      case "BULK_INPUT":
        return this.handleBulkInput(session, text);
      default:
        return this.start(session);
    }
  }

  private async handleSelectListing(session: WhatsAppSession, text: string): Promise<BotMessage> {
    // Power-user bulk shortcut is available at this step too: `SKU1=Price1, SKU2=Price2`.
    if (text.includes("=")) {
      return this.handleBulkInput(session, text);
    }

    const candidates = (session.context.candidates as Array<{ id: string; label: string; price: string }>) ?? [];
    const match = fuzzyMatch(text, candidates.map((candidate) => ({ id: candidate.id, label: candidate.label })));

    if (!match) {
      const invalidCount = this.sessionService.incrementInvalid(session.phone);
      if (invalidCount >= 3) {
        this.sessionService.resetToMainMenu(session.phone);
        return { kind: "text", text: `No match found after 3 attempts. Returning to main menu.\n\n${MENU_FOOTER}` };
      }
      return { kind: "text", text: `No match found for "${text}". Try again with the exact product name or select from the list.` };
    }

    const candidate = candidates.find((entry) => entry.id === match.id)!;
    this.sessionService.setFlow(session.phone, "PRICE_UPDATE", "ENTER_PRICE", {
      listingId: candidate.id,
      listingName: candidate.label,
      currentPrice: candidate.price,
    });

    return {
      kind: "text",
      text: `${candidate.label}\nCurrent price: ₹${candidate.price}\n\nEnter the new price (numeric, e.g. 4500):`,
    };
  }

  private async handleEnterPrice(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const newPrice = parsePositiveNumber(text);
    if (newPrice === null) {
      const invalidCount = this.sessionService.incrementInvalid(session.phone);
      if (invalidCount >= 3) {
        this.sessionService.resetToMainMenu(session.phone);
        return { kind: "text", text: `Too many invalid attempts. Returning to main menu.\n\n${MENU_FOOTER}` };
      }
      return { kind: "text", text: "Please enter a valid positive number for the new price (e.g. 4500)." };
    }

    const currentPrice = Number(session.context.currentPrice);
    const withinRange = isWithinSoftRange(newPrice, currentPrice);

    if (!withinRange) {
      this.sessionService.update(session.phone, {
        step: "CONFIRM_OUT_OF_RANGE",
        context: { ...session.context, newPrice: String(newPrice) },
      });
      return {
        kind: "buttons",
        body: `New price ₹${newPrice} is more than 80% different from the current price ₹${currentPrice}. This looks like it could be a typo. Confirm you really want this price?`,
        buttons: [
          { id: "confirm", title: "Confirm" },
          { id: "cancel", title: "Cancel" },
        ],
      };
    }

    this.sessionService.update(session.phone, {
      step: "CONFIRM_PRICE",
      context: { ...session.context, newPrice: String(newPrice) },
    });

    return {
      kind: "buttons",
      body: `Update ${session.context.listingName} price: ₹${currentPrice} → ₹${newPrice}?`,
      buttons: [
        { id: "confirm", title: "Confirm" },
        { id: "cancel", title: "Cancel" },
      ],
    };
  }

  private async handleOutOfRangeConfirm(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const choice = text.trim().toLowerCase();
    if (choice === "cancel") {
      this.sessionService.resetToMainMenu(session.phone);
      return { kind: "text", text: `Price update cancelled.\n\n${MENU_FOOTER}` };
    }
    if (choice !== "confirm") {
      return { kind: "text", text: "Please tap Confirm or Cancel." };
    }
    return this.applyPriceUpdate(session);
  }


  private async handleConfirm(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const choice = text.trim().toLowerCase();
    if (choice === "cancel") {
      this.sessionService.resetToMainMenu(session.phone);
      return { kind: "text", text: `Price update cancelled.\n\n${MENU_FOOTER}` };
    }
    if (choice !== "confirm") {
      return { kind: "text", text: "Please tap Confirm or Cancel." };
    }
    return this.applyPriceUpdate(session);
  }

  private async applyPriceUpdate(session: WhatsAppSession): Promise<BotMessage> {
    const listingId = session.context.listingId as string;
    const newPrice = session.context.newPrice as string;
    const listingName = session.context.listingName as string;
    const idempotencyKey = `price-update:${listingId}:${newPrice}:${Math.floor(Date.now() / 1000 / 30)}`;

    await this.sessionService.withIdempotency(idempotencyKey, async () => {
      await this.listingsService.update(listingId, { price: newPrice }, { userId: session.userId, email: session.email, name: session.name });
      await this.audit.record({
        actorId: session.userId,
        action: "PRICE_UPDATE",
        entityType: "Product",
        entityId: listingId,
        metadata: { newPrice, listingName },
      });
    });


    this.sessionService.resetToMainMenu(session.phone);
    return {
      kind: "text",
      text: `✅ Price updated for ${listingName}: ₹${newPrice}. It will reflect on the public feed shortly.\n\n${MENU_FOOTER}`,
    };
  }

  private async handleBulkInput(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const pairs = parseBulkPriceInput(text);
    if (!pairs.length) {
      return { kind: "text", text: "Couldn't parse that. Use the format: SKU1=Price1, SKU2=Price2" };
    }

    const listings = await this.prisma.product.findMany({
      where: { supplierId: session.supplierProfileId },
    });

    const results: string[] = [];

    for (const pair of pairs) {
      const listing = listings.find(
        (candidate) => candidate.name.toLowerCase() === pair.sku.toLowerCase() || candidate.id === pair.sku
      );
      const price = parsePositiveNumber(pair.price);

      if (!listing) {
        results.push(`❌ ${pair.sku}: listing not found`);
        continue;
      }
      if (price === null) {
        results.push(`❌ ${pair.sku}: invalid price "${pair.price}"`);
        continue;
      }
      if (!isWithinSoftRange(price, Number(listing.basePrice))) {
        results.push(`⚠️ ${pair.sku}: price deviates >80% — skipped, update individually to confirm`);
        continue;
      }

      const idempotencyKey = `price-update:${listing.id}:${price}:${Math.floor(Date.now() / 1000 / 30)}`;
      await this.sessionService.withIdempotency(idempotencyKey, async () => {
        await this.listingsService.update(listing.id, { price: String(price) }, { userId: session.userId, email: session.email, name: session.name });
        await this.audit.record({
          actorId: session.userId,
          action: "PRICE_UPDATE",
          entityType: "Product",
          entityId: listing.id,
          metadata: { newPrice: String(price), bulk: true },
        });
      });


      results.push(`✅ ${listing.name}: ₹${price}`);
    }

    this.sessionService.resetToMainMenu(session.phone);
    return { kind: "text", text: `Bulk update results:\n${results.join("\n")}\n\n${MENU_FOOTER}` };
  }
}
