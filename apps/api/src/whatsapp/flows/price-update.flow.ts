import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { ListingsService } from "src/supplier/listings/listings.service";
import { SupplierDailyPriceReminderService } from "src/notification-engine/supplier-daily-price/supplier-daily-price-reminder.service";
import { WhatsAppSession, BotMessage, MENU_FOOTER } from "../whatsapp.types";
import { WhatsAppSessionService } from "../whatsapp-session.service";
import { WhatsAppAuditHelper } from "../whatsapp-audit.helper";
import {
  fuzzyMatch,
  isSameKeyword,
  isWithinSoftRange,
  parseBulkPriceInput,
  parsePositiveNumber,
  parseSelectedSerials,
  parseSerialPriceInput,
} from "../whatsapp.utils";

export type SerialMappingItem = {
  serial: number;
  productId: string;
  name: string;
  title: string;
  unit: string;
  currentPrice: number;
};

/**
 * Flow 1 — Product Price Update (spec §4, §6-§13).
 *
 * Reuses `ListingsService.update` directly (in-process DI, not an HTTP self-call) so the
 * public listings feed freshness SLA is identical to the portal path — no separate stale
 * cache is introduced.
 *
 * Implements catalogue-aware price update workflow:
 * 1. Shows supplier's listed products with temporary serial numbers (1, 2, 3...) and current prices.
 * 2. Accepts product selection by serials (e.g. "2, 3") or SAME if unchanged.
 * 3. Confirms selection and accepts new prices (e.g. "2 - 1520, 3 - 64800").
 * 4. Partially updates only explicitly submitted, validated prices via ListingsService.update().
 * 5. Returns a confirmation receipt noting updated and unchanged products.
 */
@Injectable()
export class PriceUpdateFlow {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listingsService: ListingsService,
    private readonly sessionService: WhatsAppSessionService,
    private readonly audit: WhatsAppAuditHelper,
    @Optional() private readonly dailyPriceReminder?: SupplierDailyPriceReminderService
  ) {}

  async loadSerialMapping(supplierProfileId: string): Promise<SerialMappingItem[]> {
    const listings = await this.prisma.product.findMany({
      where: { supplierId: supplierProfileId, isActive: true },
      include: {
        category: true,
        brandRef: true,
        gradeRef: true,
        unitRef: true,
      },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    });

    return listings.map((listing, index) => {
      const serial = index + 1;
      const unit = listing.unitRef?.symbol || listing.unitRef?.name || listing.unit || "unit";
      const title = this.formatProductTitle(listing);
      return {
        serial,
        productId: listing.id,
        name: listing.name,
        title,
        unit,
        currentPrice: Number(listing.basePrice),
      };
    });
  }

  async ensureCatalogueSession(session: WhatsAppSession): Promise<SerialMappingItem[]> {
    let serialMapping = session.context?.serialMapping as SerialMappingItem[] | undefined;
    const targetStep =
      session.flow === "PRICE_UPDATE" && session.step && session.step !== "MAIN_MENU"
        ? session.step
        : "AWAITING_PRODUCT_SELECTION";

    if (!serialMapping || serialMapping.length === 0 || session.flow !== "PRICE_UPDATE") {
      serialMapping = await this.loadSerialMapping(session.supplierProfileId);
      this.sessionService.setFlow(session.phone, "PRICE_UPDATE", targetStep, {
        ...(session.context || {}),
        serialMapping,
      });
      session.flow = "PRICE_UPDATE";
      session.step = targetStep;
      session.context = { ...(session.context || {}), serialMapping };
    }
    return serialMapping;
  }

  async start(session: WhatsAppSession): Promise<BotMessage> {
    const serialMapping = await this.ensureCatalogueSession(session);

    if (serialMapping.length === 0) {
      this.sessionService.resetToMainMenu(session.phone);
      return {
        kind: "text",
        text: `You have no active listings right now. Please add or activate listings on the Matsrc Supplier Portal: ${
          process.env.SUPPLIER_PORTAL_URL || "https://matsrc-supplier.vercel.app"
        }/listings\n\n${MENU_FOOTER}`,
      };
    }

    this.sessionService.setFlow(session.phone, "PRICE_UPDATE", "AWAITING_PRODUCT_SELECTION", {
      serialMapping,
      candidates: serialMapping.map((item) => ({
        id: item.productId,
        label: item.name,
        price: item.currentPrice.toString(),
      })),
    });

    const catalogueLines = serialMapping.map(
      (item) => `${item.serial}. ${item.title}\n   Unit: ${item.unit}\n   Current Price: ₹${this.formatPrice(item.currentPrice)}/${item.unit}`
    );

    const bodyText =
      `Your Current Product Price List\n\n` +
      `Please review your listed products.\n\n` +
      `Reply with the serial numbers of products whose prices have changed.\n\n` +
      `${catalogueLines.join("\n\n")}\n\n` +
      `To update prices:\n` +
      `Reply with product numbers separated by comma (e.g. 2, 3)\n\n` +
      `If no prices have changed:\n` +
      `Reply SAME`;

    return {
      kind: "text",
      text: bodyText,
    };
  }

  async handle(session: WhatsAppSession, text: string): Promise<BotMessage> {
    await this.ensureCatalogueSession(session);
    switch (session.step) {
      case "AWAITING_PRODUCT_SELECTION":
        return this.handleProductSelection(session, text);
      case "AWAITING_PRICE_INPUT":
        return this.handlePriceInput(session, text);
      case "CONFIRM_OUT_OF_RANGE":
        return this.handleOutOfRangeConfirm(session, text);
      case "SELECT_LISTING":
        return this.handleSelectListing(session, text);
      case "ENTER_PRICE":
        return this.handleEnterPrice(session, text);
      case "CONFIRM_PRICE":
        return this.handleConfirm(session, text);
      case "BULK_INPUT":
        return this.handleBulkInput(session, text);
      default:
        return this.start(session);
    }
  }

  private async handleProductSelection(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const trimmed = text.trim();

    // 1. Check if supplier replied SAME / NO CHANGE / UNCHANGED
    if (isSameKeyword(trimmed)) {
      this.sessionService.resetToMainMenu(session.phone);
      if (this.dailyPriceReminder) {
        await this.dailyPriceReminder.resolveIfComplete(session.supplierProfileId);
      }
      return {
        kind: "text",
        text: `✅ Confirmed: all your product prices remain unchanged.\n\nYour existing prices will stay live on Matsrc.\n\nThank you!\n\n${MENU_FOOTER}`,
      };
    }

    const serialMapping = (session.context.serialMapping as SerialMappingItem[]) ?? [];

    // 2. Direct shortcut: supplier sent "2 - 1520, 3: 64800" directly at catalogue view
    const directPrices = parseSerialPriceInput(trimmed, serialMapping.map((s) => s.serial));
    if (directPrices.length > 0) {
      return this.validateAndProcessPriceUpdates(session, directPrices, serialMapping);
    }

    // 3. Parse serial numbers from text (e.g. "2, 3" or "2 3" or "2")
    const selectedSerials = parseSelectedSerials(trimmed);
    const validSerialSet = new Set(serialMapping.map((s) => s.serial));
    const matchedSerials = selectedSerials.filter((s) => validSerialSet.has(s));

    if (matchedSerials.length === 0) {
      const invalidCount = this.sessionService.incrementInvalid(session.phone);
      if (invalidCount >= 3) {
        this.sessionService.resetToMainMenu(session.phone);
        return {
          kind: "text",
          text: `Too many invalid attempts. Returning to main menu.\n\n${MENU_FOOTER}`,
        };
      }
      return {
        kind: "text",
        text: `Please reply with valid product serial numbers (1 to ${serialMapping.length}) separated by comma, e.g. "2, 3".\n\nIf no prices have changed, reply SAME.`,
      };
    }

    // Deduplicate while preserving selection order
    const uniqueSerials = Array.from(new Set(matchedSerials));

    this.sessionService.update(session.phone, {
      step: "AWAITING_PRICE_INPUT",
      context: {
        ...session.context,
        selectedSerials: uniqueSerials,
      },
    });

    const selectedItems = serialMapping.filter((m) => uniqueSerials.includes(m.serial));
    const itemsList = selectedItems
      .map(
        (item) => `${item.serial}. ${item.title}\n   Current: ₹${this.formatPrice(item.currentPrice)}/${item.unit}`
      )
      .join("\n\n");

    let exampleText = "";
    if (selectedItems.length === 1) {
      exampleText = `Example:\n${selectedItems[0].serial} - 1520`;
    } else {
      const multiLine = selectedItems.map((item) => `${item.serial} - ${Math.round(item.currentPrice * 1.05)}`).join("\n");
      const singleLine = selectedItems.map((item) => `${item.serial} - ${Math.round(item.currentPrice * 1.05)}`).join(", ");
      exampleText = `Example:\n${multiLine}\n\nOr in one line:\n${singleLine}`;
    }

    return {
      kind: "text",
      text: `Selected Products for Price Update:\n\n${itemsList}\n\nPlease reply with new prices:\n${exampleText}`,
    };
  }

  private async handlePriceInput(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    if (upper === "CANCEL") {
      this.sessionService.resetToMainMenu(session.phone);
      return {
        kind: "text",
        text: `Price update cancelled. Your existing prices remain unchanged.\n\n${MENU_FOOTER}`,
      };
    }

    if (isSameKeyword(trimmed)) {
      this.sessionService.resetToMainMenu(session.phone);
      if (this.dailyPriceReminder) {
        await this.dailyPriceReminder.resolveIfComplete(session.supplierProfileId);
      }
      return {
        kind: "text",
        text: `✅ Confirmed: all prices remain unchanged.\n\n${MENU_FOOTER}`,
      };
    }

    const selectedSerials = (session.context.selectedSerials as number[]) ?? [];
    const serialMapping = (session.context.serialMapping as SerialMappingItem[]) ?? [];

    let parsedPrices = parseSerialPriceInput(trimmed, selectedSerials);

    // If only one product was selected, accept a bare numeric price entry (e.g. "1520")
    if (parsedPrices.length === 0 && selectedSerials.length === 1) {
      const bareNumber = parsePositiveNumber(trimmed);
      if (bareNumber !== null && bareNumber > 0) {
        parsedPrices = [{ serial: selectedSerials[0], price: bareNumber }];
      }
    }

    if (parsedPrices.length === 0) {
      // If user typed serial numbers (e.g. they re-selected or changed selection like "4, 5")
      const newlySelected = parseSelectedSerials(trimmed);
      if (newlySelected.length > 0) {
        return this.handleProductSelection(session, text);
      }

      const invalidCount = this.sessionService.incrementInvalid(session.phone);
      if (invalidCount >= 3) {
        this.sessionService.resetToMainMenu(session.phone);
        return {
          kind: "text",
          text: `Too many invalid attempts. Returning to main menu.\n\n${MENU_FOOTER}`,
        };
      }
      return {
        kind: "text",
        text: `Could not parse new prices. Please enter in the format:\n${selectedSerials
          .map((s) => `${s} - <price>`)
          .join("\n")}\n\nOr reply CANCEL to exit.`,
      };
    }

    return this.validateAndProcessPriceUpdates(session, parsedPrices, serialMapping);
  }

  private async validateAndProcessPriceUpdates(
    session: WhatsAppSession,
    submittedPrices: Array<{ serial: number; price: number }>,
    serialMapping: SerialMappingItem[]
  ): Promise<BotMessage> {
    const outOfRange: Array<{ serial: number; item: SerialMappingItem; price: number }> = [];

    for (const entry of submittedPrices) {
      const item = serialMapping.find((m) => m.serial === entry.serial);
      if (item && !isWithinSoftRange(entry.price, item.currentPrice)) {
        outOfRange.push({ serial: entry.serial, item, price: entry.price });
      }
    }

    if (outOfRange.length > 0) {
      this.sessionService.update(session.phone, {
        step: "CONFIRM_OUT_OF_RANGE",
        context: {
          ...session.context,
          pendingPrices: submittedPrices,
        },
      });

      const warningLines = outOfRange
        .map(
          (o) =>
            `• ${o.item.title}: ₹${this.formatPrice(o.item.currentPrice)} → ₹${this.formatPrice(o.price)} (>80% difference)`
        )
        .join("\n");

      return {
        kind: "text",
        text:
          `⚠️ Price check warning:\n` +
          `The following price(s) deviate by more than 80% from current prices. This may be a typo:\n\n` +
          `${warningLines}\n\n` +
          `Reply CONFIRM to confirm and apply these prices, or reply CANCEL to abort.`,
      };
    }

    return this.applyPriceUpdates(session, submittedPrices, serialMapping);
  }

  private async handleOutOfRangeConfirm(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    if (upper === "CANCEL") {
      this.sessionService.resetToMainMenu(session.phone);
      return {
        kind: "text",
        text: `Price update cancelled. Your existing prices remain unchanged.\n\n${MENU_FOOTER}`,
      };
    }

    const pendingPrices = (session.context.pendingPrices as Array<{ serial: number; price: number }>) ?? [];
    const serialMapping = (session.context.serialMapping as SerialMappingItem[]) ?? [];

    if (upper === "CONFIRM") {
      return this.applyPriceUpdates(session, pendingPrices, serialMapping);
    }

    // If user provided a revised price instead of typing CONFIRM/CANCEL
    const revisedPrices = parseSerialPriceInput(trimmed, serialMapping.map((s) => s.serial));
    if (revisedPrices.length > 0) {
      return this.validateAndProcessPriceUpdates(session, revisedPrices, serialMapping);
    }

    return {
      kind: "text",
      text: `Please reply CONFIRM to confirm these prices, or reply CANCEL to abort.`,
    };
  }

  private async applyPriceUpdates(
    session: WhatsAppSession,
    pricesToApply: Array<{ serial: number; price: number }>,
    serialMapping: SerialMappingItem[]
  ): Promise<BotMessage> {
    const updatedEntries: Array<{ item: SerialMappingItem; newPrice: number }> = [];

    for (const entry of pricesToApply) {
      const item = serialMapping.find((m) => m.serial === entry.serial);
      if (!item) continue;

      const idempotencyKey = `price-update:${item.productId}:${entry.price}:${Math.floor(Date.now() / 1000 / 30)}`;
      await this.sessionService.withIdempotency(idempotencyKey, async () => {
        await this.listingsService.update(
          item.productId,
          { price: String(entry.price) },
          { userId: session.userId, email: session.email, name: session.name }
        );
        await this.audit.record({
          actorId: session.userId,
          action: "PRICE_UPDATE",
          entityType: "Product",
          entityId: item.productId,
          metadata: {
            newPrice: String(entry.price),
            previousPrice: item.currentPrice,
            serial: item.serial,
          },
        });
      });

      updatedEntries.push({ item, newPrice: entry.price });
    }

    if (this.dailyPriceReminder) {
      await this.dailyPriceReminder.resolveIfComplete(session.supplierProfileId);
    }

    const updatedSerialSet = new Set(updatedEntries.map((u) => u.item.serial));
    const updatedLines = updatedEntries.map(
      (u) => `• ${u.item.title}: ₹${this.formatPrice(u.item.currentPrice)} → ₹${this.formatPrice(u.newPrice)}/${u.item.unit}`
    );

    const unchangedItems = serialMapping.filter((m) => !updatedSerialSet.has(m.serial));
    const unchangedLines = unchangedItems.map(
      (item) => `• ${item.title}: ₹${this.formatPrice(item.currentPrice)}/${item.unit} (Unchanged)`
    );

    let receipt = `✅ Price Update Successful\n\nUpdated Products:\n${updatedLines.join("\n")}`;
    if (unchangedLines.length > 0) {
      receipt += `\n\nUnchanged Products:\n${unchangedLines.join("\n")}`;
    }
    receipt += `\n\nYour prices are now live on Matsrc.\n\n${MENU_FOOTER}`;

    this.sessionService.resetToMainMenu(session.phone);

    return {
      kind: "text",
      text: receipt,
    };
  }

  // --- Legacy Single Listing Support (Backwards Compatibility) ---

  private async handleSelectListing(session: WhatsAppSession, text: string): Promise<BotMessage> {
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

  private async handleConfirm(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const choice = text.trim().toLowerCase();
    if (choice === "cancel") {
      this.sessionService.resetToMainMenu(session.phone);
      return { kind: "text", text: `Price update cancelled.\n\n${MENU_FOOTER}` };
    }
    if (choice !== "confirm") {
      return { kind: "text", text: "Please tap Confirm or Cancel." };
    }

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

    if (this.dailyPriceReminder) {
      await this.dailyPriceReminder.resolveIfComplete(session.supplierProfileId);
    }

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

    if (this.dailyPriceReminder) {
      await this.dailyPriceReminder.resolveIfComplete(session.supplierProfileId);
    }

    this.sessionService.resetToMainMenu(session.phone);
    return { kind: "text", text: `Bulk update results:\n${results.join("\n")}\n\n${MENU_FOOTER}` };
  }

  // --- Formatting Helpers ---

  private formatPrice(price: number): string {
    if (Number.isInteger(price)) {
      return price.toLocaleString("en-IN");
    }
    return price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private formatProductTitle(p: any): string {
    const parts: string[] = [p.name];
    const brand = p.brandRef?.name || p.brand;
    if (brand && !p.name.toLowerCase().includes(brand.toLowerCase())) {
      parts.push(brand);
    }
    const grade = p.gradeRef?.name || p.grade;
    if (grade && !p.name.toLowerCase().includes(grade.toLowerCase())) {
      parts.push(grade);
    }
    if (p.sizeLabel && !p.name.toLowerCase().includes(p.sizeLabel.toLowerCase())) {
      parts.push(p.sizeLabel);
    }
    return parts.join(" – ");
  }
}
